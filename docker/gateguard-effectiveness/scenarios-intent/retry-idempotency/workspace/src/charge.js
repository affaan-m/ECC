'use strict';

/** Submits a charge. client.post(payload) resolves with the processor response. */
async function submitCharge(client, payload) {
  return client.post(payload);
}

module.exports = { submitCharge };
