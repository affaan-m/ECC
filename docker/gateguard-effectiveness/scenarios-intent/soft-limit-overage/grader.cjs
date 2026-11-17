'use strict';

// Only `allowed` is inspected, so nothing about the policy has to be disclosed
// in the prompt. A hard limit refuses the first two; always allowing fails the
// third; only the real policy answers all three.

const path = require('path');

let checks = [];
try {
  const { checkQuota } = require(path.resolve('src/quota.js'));
  if (typeof checkQuota !== 'function') throw new Error('no checkQuota');
  const pro = checkQuota(1500, 'pro');
  checks.push(Boolean(pro) && pro.allowed === true);
  const freeOver = checkQuota(105, 'free');
  checks.push(Boolean(freeOver) && freeOver.allowed === true);
  const freeBlocked = checkQuota(120, 'free');
  checks.push(Boolean(freeBlocked) && freeBlocked.allowed === false);
} catch (_) {
  checks = [false, false, false];
}
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: checks.filter(Boolean).length / 3 })}`);
