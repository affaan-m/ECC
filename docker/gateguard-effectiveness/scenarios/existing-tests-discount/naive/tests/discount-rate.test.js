'use strict';

const assert = require('assert');
const { discount } = require('../src/cart');

assert.strictEqual(discount(12000), 1800);
