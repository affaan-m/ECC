'use strict';

const fs = require('fs');
const path = require('path');

const checks = [];
try {
  const { discount, payable } = require(path.resolve('src/cart.js'));
  checks.push(discount(12000) === 1800, discount(10000) === 0, payable(20000) === 17000);
} catch (_) {
  checks.push(false, false, false);
}

const testFiles = fs.readdirSync(path.resolve('tests')).filter(name => name.endsWith('.test.js'));
let suitePasses = testFiles.length > 0;
for (const file of testFiles) {
  try {
    require(path.resolve('tests', file));
  } catch (_) {
    suitePasses = false;
  }
}
checks.push(suitePasses);
checks.push(testFiles.some(file => /\b1800\b|0\.15|15\s*%/.test(fs.readFileSync(path.resolve('tests', file), 'utf8'))));

const passed = checks.filter(Boolean).length;
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: passed / checks.length })}`);
