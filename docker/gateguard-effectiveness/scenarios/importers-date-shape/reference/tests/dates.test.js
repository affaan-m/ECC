'use strict';

const assert = require('assert');
const { parseDate } = require('../src/dates');

assert.strictEqual(parseDate('2026-03-05').toISOString(), '2026-03-05T00:00:00.000Z');
