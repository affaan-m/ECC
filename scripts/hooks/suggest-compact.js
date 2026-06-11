#!/usr/bin/env node
/**
 * Strategic Compact Suggester
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs on PreToolUse or periodically to suggest manual compaction at logical intervals
 *
 * Why manual over auto-compact:
 * - Auto-compact happens at arbitrary points, often mid-task
 * - Strategic compacting preserves context through logical phases
 * - Compact after exploration, before execution
 * - Compact after completing a milestone, before starting next
 *
 * Two signals (#2155):
 * - Tool-call count: first at COMPACT_THRESHOLD (default 50), then every 25.
 * - Context size (primary): the latest assistant `usage` record from the
 *   session transcript, compared against a window-scaled token threshold
 *   (COMPACT_CONTEXT_THRESHOLD; default 160k on a 200k window, 250k on 1M),
 *   re-reminding after every COMPACT_CONTEXT_INTERVAL tokens of growth
 *   (default 60k). Tool count is a weak proxy for window pressure — a few
 *   large reads can fill the window in very few calls, and many tiny calls
 *   can cross 50 while the window is barely used.
 */

const fs = require('fs');
const path = require('path');
const {
  getTempDir,
  writeFile,
  readStdinJson,
  log,
  output
} = require('../lib/utils');
const {
  readLatestContextTokens,
  resolveContextWindowTokens,
  resolveContextThreshold,
  resolveContextInterval,
  computeContextBucket,
  formatWindowLabel
} = require('../lib/transcript-context');

const COUNTER_FILE_PREFIX = 'claude-tool-count-';
const CONTEXT_BUCKET_FILE_PREFIX = 'claude-context-bucket-';
const STATE_FILE_PREFIXES = [COUNTER_FILE_PREFIX, CONTEXT_BUCKET_FILE_PREFIX];
const DEFAULT_COMPACT_STATE_TTL_DAYS = 14;

function getCounterRetentionDays() {
  const raw = process.env.COMPACT_STATE_TTL_DAYS;
  if (!raw) return DEFAULT_COMPACT_STATE_TTL_DAYS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_COMPACT_STATE_TTL_DAYS;
}

/**
 * Sweep stale per-session state files from the temp dir.
 *
 * Each session writes `claude-tool-count-<sessionId>` (and, with the context
 * signal, `claude-context-bucket-<sessionId>`) into the OS temp dir; nothing
 * else removes them. Without a sweep these files accumulate one-per-session
 * forever. This helper removes state files whose mtime is older than
 * `retentionDays`, while preserving the active session's files (which are
 * about to be re-written by the caller).
 *
 * The helper never throws; per the always-exit-0 hook contract any
 * filesystem failure is swallowed and logged to stderr.
 *
 * @param {string} tempDir - The temp directory to sweep.
 * @param {number} retentionDays - Files older than this many days are removed.
 * @param {string[]} currentStateFiles - Absolute paths of the active session's
 *   state files; preserved unconditionally.
 */
function cleanupOldCounters(tempDir, retentionDays, currentStateFiles) {
  let entries;
  try {
    entries = fs.readdirSync(tempDir, { withFileTypes: true });
  } catch (err) {
    log(`[StrategicCompact] Skipping counter sweep; readdir failed: ${err.message}`);
    return;
  }

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const currentBasenames = new Set(currentStateFiles.map(filePath => path.basename(filePath)));

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!STATE_FILE_PREFIXES.some(prefix => entry.name.startsWith(prefix))) continue;
    if (currentBasenames.has(entry.name)) continue;

    const fullPath = path.join(tempDir, entry.name);
    let stats;
    try {
      stats = fs.statSync(fullPath);
    } catch {
      continue;
    }

    // Strict "older than" semantics per the docstring: a file whose mtime
    // sits exactly on the cutoff boundary has age == retentionDays, which
    // is not *older than* retentionDays, so preserve it. Use >= so only
    // strictly older files (mtimeMs < cutoffMs) fall through to deletion.
    if (stats.mtimeMs >= cutoffMs) continue;

    try {
      fs.rmSync(fullPath, { force: true });
    } catch (err) {
      log(`[StrategicCompact] Warning: failed to prune stale counter ${fullPath}: ${err.message}`);
    }
  }
}

/**
 * Increment and persist the per-session tool-call counter.
 * Uses fd-based read+write to reduce (but not eliminate) the race window
 * between concurrent hook invocations.
 */
function incrementToolCallCount(counterFile) {
  let count = 1;

  try {
    const fd = fs.openSync(counterFile, 'a+');
    try {
      const buf = Buffer.alloc(64);
      const bytesRead = fs.readSync(fd, buf, 0, 64, 0);
      if (bytesRead > 0) {
        const parsed = parseInt(buf.toString('utf8', 0, bytesRead).trim(), 10);
        // Clamp to reasonable range — corrupted files could contain huge values
        // that pass Number.isFinite() (e.g., parseInt('9'.repeat(30)) => 1e+29)
        count = (Number.isFinite(parsed) && parsed > 0 && parsed <= 1000000)
          ? parsed + 1
          : 1;
      }
      // Truncate and write new value
      fs.ftruncateSync(fd, 0);
      fs.writeSync(fd, String(count), 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Fallback: just use writeFile if fd operations fail
    writeFile(counterFile, String(count));
  }

  return count;
}

/**
 * Read the last context bucket this session already fired for (-1 when the
 * suggestion has not fired yet or the state file is unreadable/corrupted).
 */
function readLastContextBucket(bucketFile) {
  try {
    const parsed = parseInt(fs.readFileSync(bucketFile, 'utf8').trim(), 10);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1000000 ? parsed : -1;
  } catch {
    return -1;
  }
}

/**
 * Build the context-size suggestion when the transcript shows the session has
 * crossed into a new context bucket. Returns null when the signal is silent
 * (no transcript, below threshold, disabled, or already fired for the bucket).
 *
 * Never throws — any transcript or state-file failure silently disables the
 * signal so the hook keeps its always-exit-0 contract.
 */
function buildContextSuggestion(transcriptPath, bucketFile, env) {
  try {
    const usage = readLatestContextTokens(transcriptPath);
    if (!usage) return null;

    const windowTokens = resolveContextWindowTokens(usage.tokens, usage.model);
    const threshold = resolveContextThreshold(env, windowTokens);
    if (threshold <= 0) return null; // COMPACT_CONTEXT_THRESHOLD=0 disables

    const interval = resolveContextInterval(env);
    const bucket = computeContextBucket(usage.tokens, threshold, interval);
    if (bucket < 0) return null;

    const lastBucket = readLastContextBucket(bucketFile);
    if (bucket <= lastBucket) return null;

    writeFile(bucketFile, String(bucket));

    const approxTokens = `${Math.round(usage.tokens / 1000)}k`;
    const percent = Math.round((usage.tokens / windowTokens) * 100);
    return `[StrategicCompact] Context ~${approxTokens} tokens (${percent}% of ${formatWindowLabel(windowTokens)} window) - consider /compact at the next logical boundary`;
  } catch (err) {
    log(`[StrategicCompact] Context signal skipped: ${err.message}`);
    return null;
  }
}

async function main() {
  // Claude Code passes hook input via stdin JSON; session_id is the
  // canonical field (legacy env var, then 'default', as fallbacks) and
  // transcript_path points at the session transcript JSONL used by the
  // context-size signal.
  let input = {};
  try {
    input = await readStdinJson({ timeoutMs: 1000 });
  } catch {
    input = {};
  }

  const rawSessionId = (input && typeof input.session_id === 'string' && input.session_id)
    ? input.session_id
    : (process.env.CLAUDE_SESSION_ID || 'default');
  const sessionId = rawSessionId.replace(/[^a-zA-Z0-9_-]/g, '') || 'default';
  const transcriptPath = (input && typeof input.transcript_path === 'string') ? input.transcript_path : '';

  const tempDir = getTempDir();
  const counterFile = path.join(tempDir, `${COUNTER_FILE_PREFIX}${sessionId}`);
  const bucketFile = path.join(tempDir, `${CONTEXT_BUCKET_FILE_PREFIX}${sessionId}`);

  // Sweep stale state files (concern 1 of #2156). Cheap, swallows errors,
  // skips the active session's files. See cleanupOldCounters for details.
  cleanupOldCounters(tempDir, getCounterRetentionDays(), [counterFile, bucketFile]);

  const rawThreshold = parseInt(process.env.COMPACT_THRESHOLD || '50', 10);
  const threshold = Number.isFinite(rawThreshold) && rawThreshold > 0 && rawThreshold <= 10000
    ? rawThreshold
    : 50;

  const count = incrementToolCallCount(counterFile);

  const messages = [];

  // Primary signal (#2155): real context size from the transcript's latest
  // usage record. Fires at a window-scaled token threshold and re-fires only
  // after the context grows by another interval step.
  const contextSuggestion = buildContextSuggestion(transcriptPath, bucketFile, process.env);
  if (contextSuggestion) {
    messages.push(contextSuggestion);
  }

  // Secondary signal: tool-call count at threshold, then every 25 calls.
  if (count === threshold) {
    messages.push(`[StrategicCompact] ${threshold} tool calls reached - consider /compact if transitioning phases`);
  } else if (count > threshold && (count - threshold) % 25 === 0) {
    messages.push(`[StrategicCompact] ${count} tool calls - good checkpoint for /compact if context is stale`);
  }

  // log() writes to stderr (debug log). Per the Claude Code hooks guide,
  // non-blocking PreToolUse stderr (exit 0) is only written to the debug log;
  // it does not reach the model. To inject a user-facing suggestion without
  // blocking the tool call, emit structured JSON to stdout with
  // hookSpecificOutput.additionalContext — the documented mechanism for
  // PreToolUse hooks to add context to the next model turn. Hooks must emit
  // at most one stdout JSON payload per run, so both signals share it.
  if (messages.length > 0) {
    for (const msg of messages) {
      log(msg);
    }
    output({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: messages.join('\n')
      }
    });
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[StrategicCompact] Error:', err.message);
  process.exit(0);
});
