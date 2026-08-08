#!/usr/bin/env node
/**
 * Cost Tracker Hook (v2)
 *
 * Reads transcript_path from Stop hook stdin, sums usage across all
 * assistant turns in the session JSONL, and appends one row to
 * ~/.claude/metrics/costs.jsonl.
 *
 * Stop hook stdin payload: { session_id, transcript_path, cwd, hook_event_name, ... }
 * The Stop payload does NOT include `usage` or `model` directly. The previous
 * version of this hook expected those fields and silently produced zero-filled
 * rows (verified: 2,340 rows captured with 0.0% non-zero token rate over 52
 * days). The fix is to read the transcript file Claude Code already passes us.
 *
 * JSONL assistant entry shape (per Claude Code):
 *   { type: "assistant", message: { model, usage: { input_tokens, output_tokens,
 *     cache_creation_input_tokens, cache_read_input_tokens } } }
 *
 * Cumulative behavior: Stop fires per assistant response, not per session.
 * Each row therefore represents the cumulative session total up to that point.
 * To get per-session cost, take the last row per session_id. To get per-day
 * spend, aggregate.
 *
 * Subagent transcripts: a session that fans out writes each subagent to its own
 * JSONL beside the main one, at
 *   <transcript_path minus .jsonl>/subagents/agent-*.jsonl
 * That spend is the parent session's (the subagent lines carry the parent's
 * `sessionId`) but it lived in files this hook never opened, so every fan-out
 * session was under-reported. Measured over 116 local sessions that fanned out:
 * $1,837 of $13,493 real spend was invisible, 13.6% of the total, and on the
 * worst session the hidden half was nearly as large as the visible one. The
 * subagent files share no `message.id` with the parent transcript (0 collisions
 * across those 116 sessions), so folding them into the same dedupe map is
 * purely additive and cannot double-count.
 *
 * Harness-cost contract (optional, opt-in by the statusline):
 *   If the user's statusline (which receives `cost.total_cost_usd` directly
 *   from Claude Code) writes `{ts, cost_usd}` to
 *   `<os.tmpdir()>/harness-cost-<session_id>.json` on each render, this hook
 *   prefers that authoritative value over the transcript-sum estimate when
 *   the cache is fresh (≤ 300s). The transcript-sum is kept as a safe
 *   fallback because:
 *     - the hard-coded rate table cannot represent Opus 4.7's >200K-token
 *       2x tier or the 1h-cache 2x tier (under-counts on long sessions).
 *       Fast mode is no longer in that list: `message.usage.speed` is present
 *       in the transcript and is now priced (see FAST_SPEED below);
 *     - summing the full transcript double-counts work done across
 *       `--resume` boundaries while `cost.total_cost_usd` is per-process.
 *   Absent a writer, behavior is unchanged.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureDir, appendFile, getClaudeDir } = require('../lib/utils');
const { sanitizeSessionId } = require('../lib/session-bridge');

const HARNESS_COST_MAX_AGE_SECONDS = 300;

/**
 * Read authoritative harness cost from the per-session cache file.
 * @param {string} sessionId
 * @param {number} maxAgeSeconds
 * @returns {number|null} cost in USD, or null on miss / stale / parse error
 */
function readHarnessCost(sessionId, maxAgeSeconds) {
  if (!sessionId) return null;
  try {
    const fp = path.join(os.tmpdir(), `harness-cost-${sessionId}.json`);
    if (!fs.existsSync(fp)) return null;
    const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const ts = Number(obj && obj.ts);
    const cost = Number(obj && obj.cost_usd);
    if (!Number.isFinite(ts) || !Number.isFinite(cost) || cost < 0) return null;
    const age = Math.floor(Date.now() / 1000) - ts;
    if (age < 0 || age > maxAgeSeconds) return null;
    return cost;
  } catch {
    return null;
  }
}

// Approximate per-1M-token billing rates (USD).
// Cache creation: 1.25x input rate. Cache read: 0.1x input rate.
const RATE_TABLE = {
  haiku:  { in: 0.80,  out: 4.0,  cacheWrite: 1.00,  cacheRead: 0.08 },
  sonnet: { in: 3.00,  out: 15.0, cacheWrite: 3.75,  cacheRead: 0.30 },
  opus:   { in: 15.00, out: 75.0, cacheWrite: 18.75, cacheRead: 1.50 }
};

function getRates(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('haiku')) return RATE_TABLE.haiku;
  if (m.includes('opus'))  return RATE_TABLE.opus;
  return RATE_TABLE.sonnet;
}

// Fast mode is a real billing tier, not a latency hint: a fast-mode response
// bills at 2x the model's standard rate. `message.usage.speed` reports which
// tier actually served the request, so the transcript carries the fact and no
// guessing is required. Measured over 1,500 local transcripts: `speed` is
// present on 123,155 of 151,286 assistant usage blocks (81.4%).
//
// The multiplier is applied on whatever `speed` says rather than on a list of
// models known to offer the tier, because a model that has no fast tier never
// emits `speed: "fast"`, so the list would add staleness without adding
// accuracy. Every fast tier published so far is exactly 2x standard; a tier
// that is not 2x would be a new rate row, the same as any repricing.
const FAST_SPEED = 'fast';
const FAST_MULTIPLIER = 2;

// Recorded on the row when `speed` was absent, which is how every transcript
// written before the field existed reads. Absent means standard rates, which
// is also the pre-change behavior, so old transcripts reprice identically.
const STANDARD_SPEED = 'standard';

const SUBAGENT_DIR_NAME = 'subagents';
const JSONL_EXT = '.jsonl';

/**
 * Rates for one usage block, accounting for the speed tier it was served at.
 * @param {string} model
 * @param {string} speed - normalized speed tier
 * @returns {object} rate row; a fresh scaled copy on the fast tier
 */
function getRatesForSpeed(model, speed) {
  const rates = getRates(model);
  if (speed !== FAST_SPEED) return rates;
  return {
    in:         rates.in * FAST_MULTIPLIER,
    out:        rates.out * FAST_MULTIPLIER,
    cacheWrite: rates.cacheWrite * FAST_MULTIPLIER,
    cacheRead:  rates.cacheRead * FAST_MULTIPLIER
  };
}

/**
 * Subagent transcripts belonging to a session, given the main transcript path.
 *
 * Claude Code lays a fan-out session out as:
 *   <dir>/<session_id>.jsonl                        <- the main transcript
 *   <dir>/<session_id>/subagents/agent-*.jsonl      <- one file per subagent
 *
 * @param {string} transcriptPath
 * @returns {string[]} absolute paths, sorted; empty when the session never
 *   fanned out. A missing directory is the normal case for most sessions, so
 *   it resolves to "no subagents" without warning or throwing: this is a
 *   non-blocking Stop hook and must stay fail-open.
 */
function subagentTranscriptPaths(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath.endsWith(JSONL_EXT)) return [];
  const sessionDir = transcriptPath.slice(0, -JSONL_EXT.length);
  const dir = path.join(sessionDir, SUBAGENT_DIR_NAME);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  // `.meta.json` sidecars live in the same directory and carry no usage.
  return names
    .filter(name => name.endsWith(JSONL_EXT))
    .sort()
    .map(name => path.join(dir, name));
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Read one transcript JSONL and fold its assistant usage into `usageById`.
 *
 * Claude Code writes one JSONL line per content block, so a single API
 * response (one message.id) spans multiple assistant lines that each repeat
 * the same message.usage. Summing every line inflates totals ~2.5-3x
 * (verified: a session with 704 assistant lines had only 286 unique
 * message.ids — $867 line-summed vs $333 deduped). Usage is therefore
 * counted once per message.id, keeping the last line seen for each id.
 *
 * @param {string} filePath
 * @param {Map} usageById - accumulator, shared across the main transcript and
 *   every subagent transcript so one dedupe map covers the whole session.
 * @param {string} keyspace - disambiguates the synthetic keys below between
 *   files, which would otherwise collide and drop real usage.
 * @returns {{ok: boolean, usageEntries: number, model: string|null}} `ok` is
 *   false only when the file could not be read at all. `usageEntries` counts
 *   the usage-bearing lines actually parsed out of it, which is what "folded
 *   in" means: a readable file whose every line fails `JSON.parse` — or a
 *   directory named `*.jsonl` — is `ok` but contributes nothing. `model` is
 *   the last model this file named, or null if it named none.
 */
function readUsageInto(filePath, usageById, keyspace) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { ok: false, usageEntries: 0, model: null };
  }

  let syntheticKey = 0;
  let usageEntries = 0;
  let model = null;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type !== 'assistant') continue;
    const msg = entry.message;
    if (!msg || !msg.usage) continue;

    // Lines without a message.id (older transcript shapes) keep the previous
    // per-line behavior via a synthetic key.
    const key = typeof msg.id === 'string' && msg.id ? msg.id : `__line_${keyspace}_${++syntheticKey}`;
    usageById.set(key, { usage: msg.usage, model: msg.model });
    usageEntries += 1;

    if (msg.model && msg.model !== 'unknown') model = msg.model;
  }

  return { ok: true, usageEntries, model };
}

/**
 * Sum a session's token usage across its main transcript and every subagent
 * transcript, grouped by the model and speed tier that actually served each
 * response.
 *
 * Grouping is what makes folding subagents in safe. The previous code priced
 * a whole session at one model's rate, which was tolerable while the only
 * turns counted were the main session's. Subagents routinely run a different
 * model than the parent (measured: 48 of 116 local fan-out sessions, 41.4%,
 * most often an Opus parent delegating to Sonnet or Haiku), so charging their
 * tokens at the parent's rate would trade one error for another. Each bucket
 * is therefore priced at its own rate and the costs are added.
 *
 * @param {string} transcriptPath
 * @returns {object|null} null when the main transcript could not be read.
 */
function sumUsageFromTranscript(transcriptPath) {
  const usageById = new Map();

  const main = readUsageInto(transcriptPath, usageById, 'main');
  if (!main.ok) return null;

  // The subagents' own models deliberately do not participate in the row's
  // `model` field: it names the session's model, which `/cost-report` groups
  // by, and letting a Haiku subagent win last-model-wins would relabel an
  // Opus session as a Haiku one. Their spend still lands in the totals and in
  // the per-model breakdown.
  const model = main.model || 'unknown';

  // Count the subagent files whose usage was actually read, not the ones that
  // were merely discovered. `subagent_transcripts` is documented as the files
  // that were folded in, and an unreadable file, a directory named `*.jsonl`,
  // or a file whose every line fails JSON.parse folds in nothing. Token totals
  // were always correct here; only this audit field over-reported.
  const subagentPaths = subagentTranscriptPaths(transcriptPath);
  let subagentTranscripts = 0;
  for (const subagentPath of subagentPaths) {
    if (readUsageInto(subagentPath, usageById, subagentPath).usageEntries > 0) {
      subagentTranscripts += 1;
    }
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;

  const buckets = new Map();

  for (const { usage, model: usageModel } of usageById.values()) {
    const input = toNumber(usage.input_tokens);
    const output = toNumber(usage.output_tokens);
    const cacheWrite = toNumber(usage.cache_creation_input_tokens);
    const cacheRead = toNumber(usage.cache_read_input_tokens);

    inputTokens += input;
    outputTokens += output;
    cacheWriteTokens += cacheWrite;
    cacheReadTokens += cacheRead;

    const bucketModel = usageModel && usageModel !== 'unknown' ? usageModel : model;
    const speed = usage.speed === FAST_SPEED ? FAST_SPEED : STANDARD_SPEED;
    // A model ID cannot contain a NUL, so this cannot collide.
    const key = `${bucketModel}\u0000${speed}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        model: bucketModel,
        speed,
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0
      };
      buckets.set(key, bucket);
    }
    bucket.inputTokens += input;
    bucket.outputTokens += output;
    bucket.cacheWriteTokens += cacheWrite;
    bucket.cacheReadTokens += cacheRead;
  }

  return {
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    model,
    buckets: [...buckets.values()],
    subagentTranscripts
  };
}

/**
 * Price one per-model, per-speed bucket.
 * @param {object} bucket
 * @returns {number} USD, rounded to 6 decimal places
 */
function priceBucket(bucket) {
  const rates = getRatesForSpeed(bucket.model, bucket.speed);
  return (
    Math.round(
      ((bucket.inputTokens / 1e6) * rates.in + (bucket.outputTokens / 1e6) * rates.out + (bucket.cacheWriteTokens / 1e6) * rates.cacheWrite + (bucket.cacheReadTokens / 1e6) * rates.cacheRead) * 1e6
    ) / 1e6
  );
}

// 1MB, matching the other Stop hooks. The Stop payload carries
// last_assistant_message, which routinely exceeded the old 64KB cap and
// made this hook echo a JSON document cut mid-stream (#2090).
const MAX_STDIN = 1024 * 1024;
let raw = '';
let truncated = false;

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (raw.length < MAX_STDIN) {
    const remaining = MAX_STDIN - raw.length;
    raw += chunk.substring(0, remaining);
    if (chunk.length > remaining) truncated = true;
  } else {
    truncated = true;
  }
});

process.stdin.on('end', () => {
  try {
    const input = raw.trim() ? JSON.parse(raw) : {};

    const transcriptPath = typeof input.transcript_path === 'string' && input.transcript_path ? input.transcript_path : process.env.CLAUDE_TRANSCRIPT_PATH || null;

    const sessionId = sanitizeSessionId(input.session_id) || sanitizeSessionId(process.env.ECC_SESSION_ID) || sanitizeSessionId(process.env.CLAUDE_SESSION_ID) || 'default';

    let usageTotals = null;
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      usageTotals = sumUsageFromTranscript(transcriptPath);
    }

    const { inputTokens = 0, outputTokens = 0, cacheWriteTokens = 0, cacheReadTokens = 0, model = 'unknown', buckets = [], subagentTranscripts = 0 } = usageTotals || {};

    // Each model and speed tier is priced at its own rate and the results are
    // summed, rather than pricing every token in the session at one model's
    // rate. Rounding is per bucket and again on the total, which can differ
    // from a single rounding by at most a millionth of a dollar per bucket.
    const pricedBuckets = buckets.map(bucket => ({
      model: bucket.model,
      speed: bucket.speed,
      input_tokens: bucket.inputTokens,
      output_tokens: bucket.outputTokens,
      cache_write_tokens: bucket.cacheWriteTokens,
      cache_read_tokens: bucket.cacheReadTokens,
      estimated_cost_usd: priceBucket(bucket)
    }));
    // Most expensive first, so the breakdown reads as an attribution and the
    // row is byte-for-byte deterministic for a given transcript. The model
    // comparison is a plain codepoint one rather than `localeCompare`, which
    // reads the active ICU locale and would let two hosts order equal-cost
    // buckets differently. `speed` breaks the remaining tie, so two buckets of
    // one model at equal cost cannot fall back to Map insertion order.
    pricedBuckets.sort(
      (a, b) =>
        b.estimated_cost_usd - a.estimated_cost_usd ||
        (a.model < b.model ? -1 : a.model > b.model ? 1 : 0) ||
        (a.speed < b.speed ? -1 : a.speed > b.speed ? 1 : 0)
    );

    const transcriptCostUsd = Math.round(pricedBuckets.reduce((sum, b) => sum + b.estimated_cost_usd, 0) * 1e6) / 1e6;

    // Prefer the harness's authoritative `cost.total_cost_usd` when the
    // statusline has written it to the per-session cache (see contract in
    // the file header). The harness number reflects API-billed truth
    // (correct rates, 1h-cache 2x, >200K tier 2x) and is per-process so it
    // does not drift across `--resume`. Cache miss → transcript-sum.
    const harnessCost = readHarnessCost(sessionId, HARNESS_COST_MAX_AGE_SECONDS);
    const estimatedCostUsd = harnessCost !== null ? Math.round(harnessCost * 1e6) / 1e6 : transcriptCostUsd;

    const metricsDir = path.join(getClaudeDir(), 'metrics');
    ensureDir(metricsDir);

    // Every pre-existing field keeps its name, type and meaning, so readers of
    // costs.jsonl need no change: `model` still names the session's model and
    // the token counts are still session totals, they simply now include the
    // subagent turns that were being dropped. `models` and
    // `subagent_transcripts` are additive.
    const row = {
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      transcript_path: transcriptPath || '',
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_write_tokens: cacheWriteTokens,
      cache_read_tokens: cacheReadTokens,
      estimated_cost_usd: estimatedCostUsd,
      subagent_transcripts: subagentTranscripts,
      models: pricedBuckets
    };

    appendFile(path.join(metricsDir, 'costs.jsonl'), `${JSON.stringify(row)}\n`);
  } catch {
    // Non-blocking — never fail the Stop hook.
  }

  // Pass stdin through (ECC hook convention) — but never echo truncated
  // stdin: invalid JSON on stdout is reported as a Stop hook failure (#2090).
  if (truncated) {
    process.stderr.write('[Hook] cost-tracker: stdin exceeded 1MB; suppressing pass-through (fail-open)\n');
    return;
  }
  process.stdout.write(raw);
});
