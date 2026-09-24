'use strict';

/**
 * Shared session bridge utilities for ECC hooks.
 *
 * The bridge file is a small JSON aggregate in /tmp that allows
 * statusline, metrics-bridge, and context-monitor to share state
 * without scanning large JSONL logs on every invocation.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_SESSION_ID_LENGTH = 64;

/**
 * Sanitize a session ID for safe use in file paths.
 * Rejects path traversal, strips unsafe chars, limits length.
 * @param {string} raw
 * @returns {string|null} Safe session ID or null if invalid
 */
function sanitizeSessionId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  if (/[/\\]|\.\./.test(raw)) return null;
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, MAX_SESSION_ID_LENGTH);
  return safe || null;
}

/**
 * Get the bridge file path for a session.
 * @param {string} sessionId - Already-sanitized session ID
 * @returns {string}
 */
function getBridgePath(sessionId) {
  return path.join(os.tmpdir(), `ecc-metrics-${sessionId}.json`);
}

/**
 * Read bridge data. Returns null on any error.
 * @param {string} sessionId - Already-sanitized session ID
 * @returns {object|null}
 */
function readBridge(sessionId) {
  try {
    const raw = fs.readFileSync(getBridgePath(sessionId), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write bridge data atomically (write unique-suffix tmp then rename).
 *
 * The tmp path includes `process.pid` plus a random nonce so concurrent
 * writers (e.g. PostToolUse `ecc-metrics-bridge` and the background
 * `ecc-statusline`, both writing to the same session bridge) do not
 * clobber each other's tmp file mid-write. With a fixed `.tmp` suffix
 * two writers could both call `writeFileSync` against the same path
 * before either reaches `renameSync`, causing one writer's payload to
 * silently overwrite the other and the second `renameSync` to throw
 * ENOENT once the rename consumes the file.
 *
 * Same pattern already used by `writeCostWarningIfChanged` in
 * `scripts/hooks/ecc-metrics-bridge.js` (commit 9b1d8918) for the
 * cost-warning cache; this commit applies it to the session-bridge
 * primitive too.
 *
 * @param {string} sessionId - Already-sanitized session ID
 * @param {object} data
 */
function writeBridgeAtomic(sessionId, data) {
  const target = getBridgePath(sessionId);
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  try {
    renameWithRetry(tmp, target);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Replace a file via rename, retrying briefly on transient OS-level errors.
 *
 * POSIX `rename(2)` is atomic between source and destination, so concurrent
 * writers each rename onto the same target without conflict. Windows
 * `MoveFileExW` is different: it fails with EPERM/EACCES/EBUSY if the
 * target is currently being renamed by *another* process — a short race
 * window that fires reliably under our PostToolUse + statusline concurrency.
 *
 * To stay portable, retry up to 5 times with exponential backoff (20 ms,
 * 40, 80, 160, 320) on the Windows-only transient codes. POSIX runs hit
 * the first try and exit immediately. Other error codes (ENOENT, ENOSPC,
 * EROFS, …) re-throw without retry — they are not transient.
 *
 * Sleep uses `Atomics.wait` on a throwaway SharedArrayBuffer so the
 * retry path does not busy-spin the CPU. This works on the main thread
 * in Node ≥ 17 (and on workers in earlier versions).
 *
 * @param {string} tmp
 * @param {string} target
 */
function renameWithRetry(tmp, target) {
  const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (err) {
      if (attempt + 1 >= MAX_ATTEMPTS || !RETRY_CODES.has(err.code)) {
        throw err;
      }
      const delayMs = 20 << attempt;
      try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
      } catch {
        // Atomics.wait throws on the main thread in some older runtimes;
        // fall back to a brief busy-wait so the retry path still has a delay.
        const until = Date.now() + delayMs;
        while (Date.now() < until) { /* spin */ }
      }
    }
  }
}

/**
 * Resolve session ID from environment variables.
 * @returns {string|null} Sanitized session ID or null
 */
function resolveSessionId() {
  const raw = process.env.ECC_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';
  return sanitizeSessionId(raw);
}

module.exports = {
  sanitizeSessionId,
  getBridgePath,
  readBridge,
  writeBridgeAtomic,
  renameWithRetry,
  resolveSessionId,
  MAX_SESSION_ID_LENGTH
};
