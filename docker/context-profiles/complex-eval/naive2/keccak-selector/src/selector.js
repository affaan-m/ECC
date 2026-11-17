'use strict';
// Deliberately naive control: confuses Keccak-256 with the finalized NIST
// SHA3-256 (different padding suffix), so every vector is wrong.
const crypto = require('node:crypto');

function functionSelector(signature) {
  if (typeof signature !== 'string') throw new TypeError('signature must be a string');
  return `0x${crypto.createHash('sha3-256').update(signature, 'utf8').digest('hex').slice(0, 8)}`;
}

module.exports = { functionSelector };
