'use strict';

const fs = require('fs');
const path = require('path');

const expected = {};
for (const line of fs.readFileSync(path.resolve('data/orders.csv'), 'utf8').trim().split(/\r?\n/).slice(1)) {
  const [, placedAt, amount] = line.split(';');
  const [, month, year] = placedAt.split('/');
  const key = `${year}-${month}`;
  expected[key] = (expected[key] || 0) + Math.round(Number(amount.replace(',', '.')) * 100);
}

let score = 0;
try {
  const actual = require(path.resolve('src/revenue.js')).monthlyRevenue();
  const keys = Object.keys(expected);
  const matches = keys.filter(key => actual && Math.round(Number(actual[key]) * 100) === expected[key]).length;
  const extra = Object.keys(actual || {}).filter(key => !(key in expected)).length;
  score = extra === 0 ? matches / keys.length : 0;
} catch (_) {
  score = 0;
}
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score })}`);
