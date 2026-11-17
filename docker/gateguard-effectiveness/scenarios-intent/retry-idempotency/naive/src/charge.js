'use strict';

const { withRetry } = require('./http');

/** The trap taken: the generic helper, which repeats a timeout. */
async function submitCharge(client, payload) {
  return withRetry(() => client.post(payload));
}

module.exports = { submitCharge };
