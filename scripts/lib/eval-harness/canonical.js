'use strict';

/**
 * Canonical JSON and hashing helpers shared by the eval-harness frameworks.
 *
 * Every hash in the capsule journal, the gate receipts, and the offline
 * receipts is computed over canonical JSON: object keys sorted recursively,
 * no whitespace, UTF-8. Two writers that agree on content therefore agree on
 * bytes, which is what makes projections and receipts reproducible.
 */

const crypto = require('crypto');

function canonicalize(value, holderKey = '') {
  // Follow JSON.stringify: a Date (or any toJSON value) is hashed as the JSON
  // it serializes to, not as its own enumerable keys, which are none.
  if (value !== null && typeof value === 'object' && typeof value.toJSON === 'function') {
    value = value.toJSON(holderKey);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalize(item, String(index)));
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    const item = canonicalize(value[key], key);
    if (item === undefined) {
      continue;
    }
    // Generic JSON keys are data, including __proto__; never invoke a setter.
    Object.defineProperty(out, key, {
      value: item, enumerable: true, writable: true, configurable: true,
    });
  }
  return out;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function hashValue(value) {
  return sha256Hex(canonicalJson(value));
}

module.exports = {
  canonicalize,
  canonicalJson,
  sha256Hex,
  hashValue,
};
