'use strict';

// Case-insensitive, hyphen and underscore equivalent, and whitespace significant.

const path = require('path');

let checks = [];
try {
  const { findUser } = require(path.resolve('src/users.js'));
  if (typeof findUser !== 'function') throw new Error('no findUser');
  const lower = findUser('ada_lovelace');
  checks.push(Boolean(lower && lower.name === 'Ada_Lovelace'));
  const swapped = findUser('grace_hopper');
  checks.push(Boolean(swapped && swapped.name === 'Grace-Hopper'));
  checks.push(findUser(' Ada_Lovelace') === undefined);
} catch (_) {
  checks = [false, false, false];
}
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: checks.filter(Boolean).length / 3 })}`);
