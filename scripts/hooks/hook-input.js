'use strict';

const { StringDecoder } = require('string_decoder');

const DEFAULT_MAX_STDIN = 1024 * 1024;
// Stay below the shortest per-hook timeout in hooks/hooks.json (5 s) so a
// stalled stdin is settled by the reader, not by the harness killing the hook.
const DEFAULT_STDIN_IDLE_TIMEOUT_MS = 3000;
// setTimeout fires after 1 ms for any delay above this, so clamp to it.
const MAX_STDIN_IDLE_TIMEOUT_MS = 2 ** 31 - 1;

function resolveMaxStdin(value, options = {}) {
  const writeDiagnostic = options.writeDiagnostic || (() => {});
  if (value === undefined || value === '') return DEFAULT_MAX_STDIN;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    writeDiagnostic(
      '[Hook] ECC_HOOK_INPUT_MAX_BYTES must be a positive safe integer; using the 1 MiB default\n'
    );
    return DEFAULT_MAX_STDIN;
  }
  if (parsed > DEFAULT_MAX_STDIN) {
    writeDiagnostic(
      '[Hook] ECC_HOOK_INPUT_MAX_BYTES exceeds the 1 MiB safety maximum; clamping to 1 MiB\n'
    );
    return DEFAULT_MAX_STDIN;
  }
  return parsed;
}

function resolveStdinIdleTimeout(value, options = {}) {
  const writeDiagnostic = options.writeDiagnostic || (() => {});
  // Number('  ') is 0, which would silently disable the deadline.
  const text = value === undefined ? '' : String(value).trim();
  if (text === '') return DEFAULT_STDIN_IDLE_TIMEOUT_MS;

  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    writeDiagnostic(
      '[Hook] ECC_HOOK_INPUT_IDLE_TIMEOUT_MS must be a non-negative safe integer; using the 3000 ms default\n'
    );
    return DEFAULT_STDIN_IDLE_TIMEOUT_MS;
  }
  if (parsed > MAX_STDIN_IDLE_TIMEOUT_MS) {
    writeDiagnostic(
      `[Hook] ECC_HOOK_INPUT_IDLE_TIMEOUT_MS exceeds the ${MAX_STDIN_IDLE_TIMEOUT_MS} ms timer maximum; clamping to it\n`
    );
    return MAX_STDIN_IDLE_TIMEOUT_MS;
  }
  return parsed;
}

// A JSON object cannot be the prefix of a longer valid document, so a payload
// that already parses as one is complete even though EOF never arrived.
function isCompleteJsonObject(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function readStdinRaw(stream = process.stdin, options = {}) {
  const maxStdin = options.maxStdin || DEFAULT_MAX_STDIN;
  const writeDiagnostic = options.writeDiagnostic
    || (stream === process.stdin ? message => process.stderr.write(message) : () => {});
  const idleTimeoutMs = options.idleTimeoutMs === undefined
    ? resolveStdinIdleTimeout(process.env.ECC_HOOK_INPUT_IDLE_TIMEOUT_MS, { writeDiagnostic })
    : options.idleTimeoutMs;
  const decoder = new StringDecoder('utf8');
  let raw = '';
  let acceptedBytes = 0;
  let truncated = options.truncated === true;

  return new Promise(resolve => {
    let settled = false;
    let idleTimer = null;
    const clearIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
    };
    const armIdleTimer = () => {
      if (!(idleTimeoutMs > 0)) return;
      clearIdleTimer();
      idleTimer = setTimeout(onIdleTimeout, idleTimeoutMs);
      // Never keep the process alive just to wait for this deadline.
      if (typeof idleTimer.unref === 'function') idleTimer.unref();
    };
    const onData = chunk => {
      armIdleTimer();
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (typeof options.onChunk === 'function') options.onChunk(buffer);
      const remaining = Math.max(0, maxStdin - acceptedBytes);
      const accepted = buffer.subarray(0, remaining);
      if (accepted.length > 0) {
        raw += decoder.write(accepted);
        acceptedBytes += accepted.length;
      }
      if (accepted.length < buffer.length) truncated = true;
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearIdleTimer();
      if (!truncated) raw += decoder.end();
      resolve({ raw, truncated });
    };
    const finishIncomplete = () => {
      if (settled) return;
      truncated = true;
      finish();
    };
    // The writer kept stdin open without sending EOF (#3665). Stop reading
    // and release the stream so a held-open pipe cannot keep the hook alive.
    // Anything short of a complete JSON object is marked incomplete so safety
    // hooks remain fail closed.
    function onIdleTimeout() {
      idleTimer = null;
      if (settled) return;
      stream.removeListener('data', onData);
      if (typeof stream.pause === 'function') stream.pause();
      if (!truncated) {
        const pending = raw + decoder.end();
        if (isCompleteJsonObject(pending)) {
          raw = pending;
          settled = true;
          resolve({ raw, truncated: false });
          return;
        }
        raw = pending;
      }
      writeDiagnostic(
        `[Hook] stdin stayed open without EOF for ${idleTimeoutMs} ms; treating the hook input as incomplete\n`
      );
      finishIncomplete();
    }
    stream.on('data', onData);
    stream.once('end', finish);
    // A transport error or premature close can leave a syntactically plausible
    // prefix behind. Mark it incomplete so safety hooks remain fail closed.
    stream.once('error', finishIncomplete);
    stream.once('close', finishIncomplete);
    armIdleTimer();
  });
}

module.exports = {
  DEFAULT_MAX_STDIN,
  DEFAULT_STDIN_IDLE_TIMEOUT_MS,
  readStdinRaw,
  resolveMaxStdin,
  resolveStdinIdleTimeout
};
