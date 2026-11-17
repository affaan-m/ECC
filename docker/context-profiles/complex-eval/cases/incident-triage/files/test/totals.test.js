'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOrderTotal } = require('../src/totals');

test('sums lines without a discount', () => {
  assert.equal(computeOrderTotal({ lines: [{ priceCents: 1000, quantity: 2 }], discountPercent: 0 }), 2000);
});

test('applies a clean quarter discount', () => {
  assert.equal(computeOrderTotal({ lines: [{ priceCents: 2000, quantity: 1 }], discountPercent: 25 }), 1500);
});

test('multiplies quantity before discounting', () => {
  assert.equal(computeOrderTotal({ lines: [{ priceCents: 400, quantity: 3 }], discountPercent: 50 }), 600);
});
