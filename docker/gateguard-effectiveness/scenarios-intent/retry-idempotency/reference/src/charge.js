'use strict';

const MAX_ATTEMPTS = 2;

/**
 * The endpoint is not idempotent, so only a failure that proves nothing was
 * sent may be repeated. A timeout does not prove that.
 */
async function submitCharge(client, payload) {
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await client.post(payload);
    } catch (error) {
      lastError = error;
      if (error && error.code === 'ECONNREFUSED') continue;
      throw error;
    }
  }
  throw lastError;
}

module.exports = { submitCharge };
