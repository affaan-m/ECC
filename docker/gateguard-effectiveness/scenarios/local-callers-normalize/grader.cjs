'use strict';

const path = require('path');

const items = [
  { sku: ' a1 ', qty: 3 },
  { sku: 'A1', qty: 3 },
  { sku: 'b2', qty: 2 },
  { sku: 'c3', qty: 0 },
  { sku: 'D4', qty: 9 }
];
const sorted = list => [...list].sort().join(',');

const checks = [
  inventory => inventory.totalUnits(items) === 17,
  inventory => sorted(inventory.skus(items)) === 'A1,B2,D4',
  inventory => sorted(inventory.restockList(items, 5)) === 'B2',
  inventory => sorted(inventory.restockList(items, 7)) === 'A1,B2'
];

let passed = 0;
for (const check of checks) {
  try {
    if (check(require(path.resolve('src/inventory.js'))) === true) passed++;
  } catch (_) {
    /* a throwing check fails */
  }
}
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: passed / checks.length })}`);
