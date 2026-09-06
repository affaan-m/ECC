'use strict';

const { StringDecoder } = require('string_decoder');

const DEFAULT_MAX_STDIN = 1024 * 1024;

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

function readStdinRaw(stream = process.stdin, options = {}) {
  const maxStdin = options.maxStdin || DEFAULT_MAX_STDIN;
  const decoder = new StringDecoder('utf8');
  let raw = '';
  let acceptedBytes = 0;
  let truncated = options.truncated === true;

  return new Promise(resolve => {
    let settled = false;
    stream.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, maxStdin - acceptedBytes);
      const accepted = buffer.subarray(0, remaining);
      if (accepted.length > 0) {
        raw += decoder.write(accepted);
        acceptedBytes += accepted.length;
      }
      if (accepted.length < buffer.length) truncated = true;
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      if (!truncated) raw += decoder.end();
      resolve({ raw, truncated });
    };
    stream.once('end', finish);
    stream.once('error', () => {
      // A transport error can leave a syntactically plausible prefix behind.
      // Mark it incomplete so safety hooks retain their fail-closed behavior.
      truncated = true;
      finish();
    });
  });
}

module.exports = {
  DEFAULT_MAX_STDIN,
  readStdinRaw,
  resolveMaxStdin
};
