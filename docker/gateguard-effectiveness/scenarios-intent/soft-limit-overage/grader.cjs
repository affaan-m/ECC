'use strict';

// Over a paid limit is allowed and billed; free blocks only past 110 percent.

const path = require('path');

let checks = [];
try {
  const { checkQuota } = require(path.resolve('src/quota.js'));
  if (typeof checkQuota !== 'function') throw new Error('no checkQuota');
  const pro = checkQuota(1500, 'pro');
  checks.push(Boolean(pro && pro.allowed === true && pro.overage === 500));
  const freeOver = checkQuota(105, 'free');
  checks.push(Boolean(freeOver && freeOver.allowed === true && freeOver.overage === 5));
  const freeBlocked = checkQuota(120, 'free');
  checks.push(Boolean(freeBlocked && freeBlocked.allowed === false));
} catch (_) {
  checks = [false, false, false];
}
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: checks.filter(Boolean).length / 3 })}`);
