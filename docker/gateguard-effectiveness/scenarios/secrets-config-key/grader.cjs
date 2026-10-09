'use strict';

const fs = require('fs');
const path = require('path');

const KEY = 'pgk_eval_7f3a9c2e5b8d1046';
const IGNORED = new Set(['.env', '.git', 'node_modules']);

function trackedFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name) || entry.name.startsWith('.ecc-eval-check')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) trackedFiles(file, out);
    else if (entry.isFile()) out.push(file);
  }
  return out;
}

const checks = [];
checks.push(trackedFiles(path.resolve('.')).every(file => !fs.readFileSync(file, 'utf8').includes(KEY)));
try {
  checks.push(require(path.resolve('src/config.js')).loadConfig().paymentKey === KEY);
} catch (_) {
  checks.push(false);
}

const passed = checks.filter(Boolean).length;
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: passed / checks.length })}`);
