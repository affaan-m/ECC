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
 * Harness-cost contract (optional, opt-in by the statusline):
 *   If the user's statusline (which receives `cost.total_cost_usd` directly
 *   from Claude Code) writes `{ts, cost_usd}` to
 *   `<os.tmpdir()>/harness-cost-<session_id>.json` on each render, this hook
 *   prefers that authoritative value over the transcript-sum estimate when
 *   the cache is fresh (≤ 300s). The transcript-sum is kept as a safe
 *   fallback because:
 *     - the hard-coded rate table cannot represent Opus 4.7's >200K-token
 *       2x tier or the 1h-cache 2x tier (under-counts on long sessions);
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

// Per-1M-token billing rates (USD). Cache write is 1.25x input and cache read
// is 0.1x input in every row, for the default 5-minute cache TTL. The 1-hour
// TTL bills writes at 2x input and is still not modelled here, as the header
// notes.
//
// The previous table priced every `opus` model at $15/$75, which are Claude 3
// Opus era rates. Opus 4.5 and later bill at $5/$25, so every current-
// generation Opus session was reported at exactly 3x real spend (measured: a
// session summing to 100,000,000 cache-read plus 500,000 output tokens on
// `claude-opus-5` costs $62.50 and was reported as $187.50). Fable and Mythos
// had no bucket at all, so they fell through to `sonnet` and were understated
// 3.3x. The rate constants were the whole defect; the arithmetic that
// consumes them is unchanged.
//
// The legacy rows exist so that correcting the current generation does not
// reprice the old one. `haikuLegacy` is Claude 3.5 Haiku, for which the
// previous $0.80/$4.00 was exactly right. Claude 3 Haiku ($0.25/$1.25) is
// deliberately not modelled: Claude Code never ran it.
const RATE_TABLE = {
  haiku:       { in: 1.00,  out: 5.0,  cacheWrite: 1.25,  cacheRead: 0.10 },
  haikuLegacy: { in: 0.80,  out: 4.0,  cacheWrite: 1.00,  cacheRead: 0.08 },
  sonnet:      { in: 3.00,  out: 15.0, cacheWrite: 3.75,  cacheRead: 0.30 },
  opus:        { in: 5.00,  out: 25.0, cacheWrite: 6.25,  cacheRead: 0.50 },
  opusLegacy:  { in: 15.00, out: 75.0, cacheWrite: 18.75, cacheRead: 1.50 },
  fable:       { in: 10.00, out: 50.0, cacheWrite: 12.50, cacheRead: 1.00 }
};

// The only Opus models that really billed at $15/$75: Claude 3 Opus, Opus 4.0
// and Opus 4.1. Every spelling of each has to match, alias and dated snapshot
// alike, which is why the bare `opus-4-<date>` form is listed on its own:
// Opus 4.0's snapshot is `claude-opus-4-20250514`, with no minor segment, so
// an `opus-4-0` substring alone misses it and reprices a legacy session at a
// third of its real cost. The `[-@]` covers Vertex AI, which joins the date
// with `@` (`claude-opus-4@20250514`); Bedrock's
// `anthropic.claude-3-opus-20240229-v1:0` is caught by the first alternative.
//
// Opus 4.5 through Opus 5 are $5/$25 and take the default bucket, which also
// means a future Opus is assumed to be $5/$25. That assumption is the same
// shape of silent staleness this change fixes, so if Opus is ever repriced
// again, a new row belongs here rather than a rediscovery of this comment.
const LEGACY_OPUS_RE = /claude-3-opus|opus-4-0(?!\d)|opus-4-1(?!\d)|opus-4[-@]\d{8}/;

// Claude 3.5 Haiku, whose $0.80/$4.00 this table used to apply to all Haiku.
const LEGACY_HAIKU_RE = /3-5-haiku|haiku-3-5/;

// Recorded on the row, and warned about, when the model ID matched no bucket.
// Returning sonnet rates anyway keeps this Stop hook fail-open, but an
// unpriceable model used to yield a plausible number with no signal at all,
// which is how the stale Opus rate survived unnoticed.
const FALLBACK_BUCKET = 'sonnet-fallback';

// Recorded instead when the harness's own `cost.total_cost_usd` supplied the
// number, in which case no rate-table row was consulted at all.
const HARNESS_BUCKET = 'harness';

// `message.model` values that name no model. `<synthetic>` is what Claude Code
// writes for interrupts, API errors and "no response requested"; it carries a
// fully populated but all-zero `usage` block, so it clears the usage guard
// below and, under last-model-wins, would overwrite the real model for the
// whole session. Measured over 1,628 local transcripts: 60 `<synthetic>`
// entries, and 10 transcripts END on one. That last case is the damaging one,
// because the final row is exactly the cumulative row `/cost-report` reads
// per session.
const NON_MODEL_SENTINELS = new Set(['unknown', '<synthetic>']);

/**
 * Resolve billing rates for a model ID.
 * @param {string} model
 * @returns {{bucket: string, rates: object}} `bucket` is FALLBACK_BUCKET when
 *   nothing matched and sonnet rates were assumed.
 */
function resolveRates(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('haiku')) {
    return LEGACY_HAIKU_RE.test(m)
      ? { bucket: 'haiku-legacy', rates: RATE_TABLE.haikuLegacy }
      : { bucket: 'haiku',        rates: RATE_TABLE.haiku };
  }
  if (m.includes('fable') || m.includes('mythos')) {
    return { bucket: 'fable', rates: RATE_TABLE.fable };
  }
  if (m.includes('opus')) {
    return LEGACY_OPUS_RE.test(m)
      ? { bucket: 'opus-legacy', rates: RATE_TABLE.opusLegacy }
      : { bucket: 'opus',        rates: RATE_TABLE.opus };
  }
  if (m.includes('sonnet')) return { bucket: 'sonnet', rates: RATE_TABLE.sonnet };
  return { bucket: FALLBACK_BUCKET, rates: RATE_TABLE.sonnet };
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Scan the session JSONL and sum token usage across all assistant turns.
 * Returns { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, model }
 * or null on read failure.
 *
 * Claude Code writes one JSONL line per content block, so a single API
 * response (one message.id) spans multiple assistant lines that each repeat
 * the same message.usage. Summing every line inflates totals ~2.5-3x
 * (verified: a session with 704 assistant lines had only 286 unique
 * message.ids — $867 line-summed vs $333 deduped). Usage is therefore
 * counted once per message.id, keeping the last line seen for each id.
 */
function sumUsageFromTranscript(transcriptPath) {
  let content;
  try {
    content = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  const usageById = new Map();
  let syntheticKey = 0;
  let model = 'unknown';

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.type !== 'assistant') continue;
    const msg = entry.message;
    if (!msg || !msg.usage) continue;

    // Lines without a message.id (older transcript shapes) keep the previous
    // per-line behavior via a synthetic key.
    const key = (typeof msg.id === 'string' && msg.id)
      ? msg.id
      : `__line_${++syntheticKey}`;
    usageById.set(key, msg.usage);

    if (msg.model && !NON_MODEL_SENTINELS.has(msg.model)) model = msg.model;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;

  for (const u of usageById.values()) {
    inputTokens      += toNumber(u.input_tokens);
    outputTokens     += toNumber(u.output_tokens);
    cacheWriteTokens += toNumber(u.cache_creation_input_tokens);
    cacheReadTokens  += toNumber(u.cache_read_input_tokens);
  }

  return { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, model };
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

    const transcriptPath = (typeof input.transcript_path === 'string' && input.transcript_path)
      ? input.transcript_path
      : process.env.CLAUDE_TRANSCRIPT_PATH || null;

    const sessionId =
      sanitizeSessionId(input.session_id) ||
      sanitizeSessionId(process.env.ECC_SESSION_ID) ||
      sanitizeSessionId(process.env.CLAUDE_SESSION_ID) ||
      'default';

    let usageTotals = null;
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      usageTotals = sumUsageFromTranscript(transcriptPath);
    }

    const {
      inputTokens = 0,
      outputTokens = 0,
      cacheWriteTokens = 0,
      cacheReadTokens = 0,
      model = 'unknown'
    } = usageTotals || {};

    const { bucket: modelBucket, rates } = resolveRates(model);
    const transcriptCostUsd = Math.round((
      (inputTokens      / 1e6) * rates.in +
      (outputTokens     / 1e6) * rates.out +
      (cacheWriteTokens / 1e6) * rates.cacheWrite +
      (cacheReadTokens  / 1e6) * rates.cacheRead
    ) * 1e6) / 1e6;

    // Prefer the harness's authoritative `cost.total_cost_usd` when the
    // statusline has written it to the per-session cache (see contract in
    // the file header). The harness number reflects API-billed truth
    // (correct rates, 1h-cache 2x, >200K tier 2x) and is per-process so it
    // does not drift across `--resume`. Cache miss → transcript-sum.
    const harnessCost = readHarnessCost(sessionId, HARNESS_COST_MAX_AGE_SECONDS);
    const estimatedCostUsd = harnessCost !== null
      ? Math.round(harnessCost * 1e6) / 1e6
      : transcriptCostUsd;

    // `rate_bucket` names what produced `estimated_cost_usd`, so it has to
    // follow that choice: on the harness path no rate-table row was consulted,
    // and reporting the model's bucket there would vouch for a number the
    // table did not produce (or, worse, flag an authoritative number as a
    // guess).
    const rateBucket = harnessCost !== null ? HARNESS_BUCKET : modelBucket;

    // Speak up when a guessed rate is what actually produced the recorded
    // cost. Silent on the harness path by construction, and gated on a
    // non-zero cost so a Stop that priced nothing stays quiet. `model` is
    // skipped when it is the `unknown` sentinel: that means no assistant turn
    // recorded a model, so naming it in the warning tells the reader nothing
    // actionable, and the `sonnet-fallback` value on the row already carries
    // the signal. Note this fires per Stop, and Stop fires per assistant
    // response, so an unrecognized model warns once per turn by design: the
    // row is the durable record, the line is the nudge.
    if (rateBucket === FALLBACK_BUCKET && transcriptCostUsd > 0 && model !== 'unknown') {
      process.stderr.write(
        `[Hook] cost-tracker: unrecognized model "${model}"; priced at sonnet rates, cost may be wrong\n`
      );
    }

    const metricsDir = path.join(getClaudeDir(), 'metrics');
    ensureDir(metricsDir);

    const row = {
      timestamp:          new Date().toISOString(),
      session_id:         sessionId,
      transcript_path:    transcriptPath || '',
      model,
      rate_bucket:        rateBucket,
      input_tokens:       inputTokens,
      output_tokens:      outputTokens,
      cache_write_tokens: cacheWriteTokens,
      cache_read_tokens:  cacheReadTokens,
      estimated_cost_usd: estimatedCostUsd
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
