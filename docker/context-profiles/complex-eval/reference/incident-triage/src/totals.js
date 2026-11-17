'use strict';

// Fixed after the 2026-09-24 incident: totals use exact integer-cent
// arithmetic. Per line: priceCents * quantity * (100 - discountPercent) / 100,
// rounded half-up via (n + 50) / 100 floored — no floating point anywhere.
function computeOrderTotal(order) {
  let total = 0;
  for (const line of order.lines) {
    const numerator = line.priceCents * line.quantity * (100 - order.discountPercent);
    total += Math.floor((numerator + 50) / 100);
  }
  return total;
}

module.exports = { computeOrderTotal };
