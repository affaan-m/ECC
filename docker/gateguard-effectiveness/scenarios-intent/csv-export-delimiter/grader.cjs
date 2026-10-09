'use strict';

// Scores against the hidden dialect: semicolons, CRLF, every field quoted.

const path = require('path');

let checks = [];
try {
  const { exportCsv } = require(path.resolve('src/export.js'));
  if (typeof exportCsv !== 'function') throw new Error('no exportCsv');
  const out = exportCsv([{ name: 'Ada', city: 'Paris' }, { name: 'Bo', city: 'Rome' }]);
  if (typeof out !== 'string') throw new Error('not a string');
  const lines = out.split('\r\n').filter(Boolean);
  checks.push(out.includes('\r\n'));
  checks.push(lines.length >= 2 && lines.every(line => line.includes(';')));
  checks.push(lines.length >= 2 && lines.every(line => /^"[^"]*"(;"[^"]*")*$/.test(line)));
} catch (_) {
  checks = [false, false, false];
}
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: checks.filter(Boolean).length / 3 })}`);
