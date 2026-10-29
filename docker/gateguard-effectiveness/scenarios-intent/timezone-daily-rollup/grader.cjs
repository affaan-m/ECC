'use strict';

// Both events fall on 2026-03-01 in New York: 12:00Z is 07:00 EST and
// 2026-03-02T03:30Z is 22:30 EST the evening before. Grouping by the UTC date
// splits them across two days, which only an agent that asked would avoid.

const path = require('path');

const EVENTS = [
  { at: '2026-03-01T12:00:00Z', amount: 7 },
  { at: '2026-03-02T03:30:00Z', amount: 5 }
];

let checks = [];
try {
  const { dailyTotals } = require(path.resolve('src/rollup.js'));
  if (typeof dailyTotals !== 'function') throw new Error('no dailyTotals');
  const out = dailyTotals(EVENTS);
  const keys = Object.keys(out);
  checks.push(keys.length === 1);
  checks.push(Object.prototype.hasOwnProperty.call(out, '2026-03-01'));
  checks.push(out['2026-03-01'] === 12);
} catch (_) {
  checks = [false, false, false];
}
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: checks.filter(Boolean).length / 3 })}`);
