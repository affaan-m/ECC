'use strict';

/**
 * Resolve a raw hook session ID from stdin before legacy environment fallbacks.
 * Callers must retain their own filename sanitization at the storage boundary.
 * @param {string} rawInput - Hook stdin JSON.
 * @param {object} env - Environment variables; defaults to the current process.
 * @returns {string} A nonblank session ID, or an empty string when unavailable.
 */
function resolveHookSessionId(rawInput, env = process.env) {
  let sessionId;
  try {
    const input = JSON.parse(rawInput);
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      sessionId = input.session_id;
    }
  } catch {
    // Empty or malformed hook input can still use an environment session ID.
  }

  return [sessionId, env.ECC_SESSION_ID, env.CLAUDE_SESSION_ID]
    .find(value => typeof value === 'string' && value.trim().length > 0) || '';
}

module.exports = { resolveHookSessionId };
