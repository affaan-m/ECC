'use strict';

/**
 * ECC eval-harness frameworks.
 *
 * envelope  capsule-envelope/v1 contract, redaction, secret canaries
 * capsule   append-only hash-linked journal with five lineages
 * gate      staged verification gate, external checker, tripwires
 * replay    declared tool effects, fixtures, fail-closed replay, effect fence
 * receipt   offline-verifiable capsule receipts
 *
 * See docs/architecture/eval-harness-frameworks.md and examples/eval-harness.
 */

module.exports = {
  canonical: require('./canonical'),
  envelope: require('./envelope'),
  capsule: require('./capsule'),
  gate: require('./gate'),
  replay: require('./replay'),
  receipt: require('./receipt'),
};
