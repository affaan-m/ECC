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

// Shared prefix for the per-session counter temp files. Used both to build the
// current session's counter path and to sweep stale ones.
const COUNTER_PREFIX = 'claude-tool-count-';

/**
 * Resolve the retention window (in days) for stale counter temp files.
 * Env-tunable via COMPACT_STATE_TTL_DAYS. 0 disables the sweep. Invalid or
 * out-of-range values fall back to the conservative 14-day default.
 */
function resolveTtlDays() {
  const raw = parseInt(process.env.COMPACT_STATE_TTL_DAYS || '14', 10);
  if (!Number.isFinite(raw) || raw < 0 || raw > 3650) return 14;
  return raw;
}

/**
 * Best-effort cleanup of orphaned counter temp files.
 *
 * Each session writes one `claude-tool-count-<sessionId>` file and nothing ever
 * removed them, so the temp dir grew unbounded (one file per session, forever —
 * issue #2156). Sweep deletes counter files whose mtime is older than the
 * retention window. It never throws: counting must not depend on cleanup
 * succeeding, and a hook must never block Claude.
 *
 * @param {string} tempDir   Directory holding the counter files.
 * @param {number} ttlDays   Retention window in days (0 = sweep disabled).
 * @param {string} keepFile  Absolute path of the current session's counter
 *                           file, which is never deleted even if stale.
 */
function sweepStaleCounters(tempDir, ttlDays, keepFile) {
  if (!ttlDays || ttlDays <= 0) return;
  const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
  let entries;
  try {
    entries = fs.readdirSync(tempDir);
  } catch {
    return; // temp dir unreadable — nothing to do
  }
  for (const name of entries) {
    if (!name.startsWith(COUNTER_PREFIX)) continue;
    const full = path.join(tempDir, name);
    if (full === keepFile) continue;
    try {
      const stats = fs.statSync(full);
      if (stats.isFile() && stats.mtimeMs < cutoff) {
        fs.unlinkSync(full);
      }
    } catch {
      // File vanished mid-sweep, or is unreadable — ignore and continue.
    }
  }
}

async function resolveSessionId() {
  // Claude Code passes hook input via stdin JSON; session_id is the
  // canonical field. Fall back to the legacy env var, then 'default'.
  try {
    const input = await readStdinJson({ timeoutMs: 1000 });
    if (input && typeof input.session_id === 'string' && input.session_id) {
      return input.session_id;
    }
  } catch {
    /* fall through to env */
  }
  return process.env.CLAUDE_SESSION_ID || 'default';
}

async function main() {
  // Track tool call count (increment in a temp file)
  // Use a session-specific counter file based on session ID from stdin JSON,
  // legacy env var, or 'default' as fallback.
  const rawSessionId = await resolveSessionId();
  const sessionId = rawSessionId.replace(/[^a-zA-Z0-9_-]/g, '') || 'default';
  const tempDir = getTempDir();
  const counterFile = path.join(tempDir, `${COUNTER_PREFIX}${sessionId}`);

  // Keep the temp dir bounded by sweeping stale counter files (#2156), but only
  // pay for the directory scan once per session. The sweep only needs to run on
  // a session's first tool call — i.e. when this session's counter file does not
  // exist yet. On every subsequent PreToolUse the file is already present, so we
  // skip the readdir/stat entirely and keep the blocking hot path fast. Stale
  // files still get cleaned up promptly because every new session triggers a
  // sweep. Best-effort throughout and never blocks.
  let isFirstToolCall;
  try {
    isFirstToolCall = !fs.existsSync(counterFile);
  } catch {
    isFirstToolCall = true; // can't tell — fall back to attempting the sweep
  }
  if (isFirstToolCall) {
    try {
      sweepStaleCounters(tempDir, resolveTtlDays(), counterFile);
    } catch {
      /* cleanup is best-effort — never let it affect the count or exit code */
    }
  }

  const rawThreshold = parseInt(process.env.COMPACT_THRESHOLD || '50', 10);
  const threshold = Number.isFinite(rawThreshold) && rawThreshold > 0 && rawThreshold <= 10000
    ? rawThreshold
    : 50;

  let count = 1;

  // Read existing count or start at 1
  // Use fd-based read+write to reduce (but not eliminate) race window
  // between concurrent hook invocations
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

  // Suggest compact after threshold tool calls.
  //
  // log() writes to stderr (debug log). Per the Claude Code hooks guide,
  // non-blocking PreToolUse stderr (exit 0) is only written to the debug log;
  // it does not reach the model. To inject a user-facing suggestion without
  // blocking the tool call, emit structured JSON to stdout with
  // hookSpecificOutput.additionalContext — the documented mechanism for
  // PreToolUse hooks to add context to the next model turn.
  if (count === threshold) {
    const msg = `[StrategicCompact] ${threshold} tool calls reached - consider /compact if transitioning phases`;
    log(msg);
    output({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg } });
  }

  // Suggest at regular intervals after threshold (every 25 calls from threshold)
  if (count > threshold && (count - threshold) % 25 === 0) {
    const msg = `[StrategicCompact] ${count} tool calls - good checkpoint for /compact if context is stale`;
    log(msg);
    output({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg } });
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[StrategicCompact] Error:', err.message);
  process.exit(0);
});
