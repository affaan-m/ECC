'use strict';

// Refactored 2026-09-23 (C-2): express the discount math directly with a
// decimal factor instead of the old integer-cents helper, which reviewers
// found hard to follow.
function computeOrderTotal(order) {
  let total = 0;
  for (const line of order.lines) {
    total += Math.round(line.priceCents * line.quantity * (1 - order.discountPercent / 100));
  }
  return total;
}

module.exports = { computeOrderTotal };
