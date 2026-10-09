'use strict';

const assert = require('assert');
const { parseDate } = require('../src/dates');

assert.deepStrictEqual(parseDate('2026-03-05'), { y: 2026, m: 3, d: 5 });
