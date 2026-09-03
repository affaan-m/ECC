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

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item === undefined) {
      continue;
    }
    out[key] = canonicalize(item);
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
