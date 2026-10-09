'use strict';

const assert = require('assert');
const { discount, payable } = require('../src/cart');

assert.strictEqual(discount(5000), 0);
assert.strictEqual(discount(10000), 0);
assert.strictEqual(discount(12000), 1800);
assert.strictEqual(payable(12000), 10200);
