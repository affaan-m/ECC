'use strict';

const path = require('path');

const checks = [
  () => {
    const value = require(path.resolve('src/dates.js')).parseDate('2026-03-05');
    return value instanceof Date && value.toISOString() === '2026-03-05T00:00:00.000Z';
  },
  () => require(path.resolve('src/report.js')).monthOf({ date: '2026-03-05' }) === '2026-03',
  () => JSON.stringify(require(path.resolve('src/report.js')).totalsByMonth([{ date: '2026-01-31', amount: 2 }, { date: '2026-02-01', amount: 3 }])) === '{"2026-01":2,"2026-02":3}',
  () => require(path.resolve('src/invoice.js')).dueDate('2026-01-30', 5) === '2026-02-04',
  () => require(path.resolve('lib/export/csv.js')).toRow({ date: '2026-03-05', amount: 12 }) === '05/03/2026,12'
];

let passed = 0;
for (const check of checks) {
  try {
    if (check() === true) passed++;
  } catch (_) {
    /* a throwing check fails */
  }
}
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: passed / checks.length })}`);
