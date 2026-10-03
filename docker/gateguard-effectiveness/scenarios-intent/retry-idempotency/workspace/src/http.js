'use strict';

/** Generic retry used by the read-only reporting calls. */
async function withRetry(call, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await call();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

module.exports = { withRetry };
