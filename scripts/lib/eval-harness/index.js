'use strict';

/**
 * ECC eval-harness frameworks.
 *
 * envelope  capsule-envelope/v1 contract, redaction, secret canaries
 * capsule   append-only hash-linked journal with five lineages
 * retrospective  offline report-only grouping of selected capsule snapshots
 * gate      static inspection and disabled execution gate, syntactic warnings
 * replay    declared tool effects, fixtures, fail-closed replay, retired effect preload
 * receipt   offline-verifiable capsule receipts
 *
 * See docs/architecture/eval-harness-frameworks.md and examples/eval-harness.
 */

module.exports = {
  canonical: require('./canonical'),
  envelope: require('./envelope'),
  capsule: require('./capsule'),
  retrospective: require('./retrospective'),
  gate: require('./gate'),
  replay: require('./replay'),
  receipt: require('./receipt'),
};
