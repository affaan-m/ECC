'use strict';

// Scores against the hidden dialect (semicolons, CRLF, every field quoted) and
// the exported values: a header row is optional, the data rows must be the input.

const path = require('path');

const CASES = [
  [{ name: 'Ada', city: 'Paris' }, { name: 'Bo', city: 'Rome' }],
  [{ name: 'Fay', city: 'Delhi' }, { name: 'Gus', city: 'Seoul' }],
  [{ name: 'Cy', city: 'Oslo' }, { name: 'Dee', city: 'Lima' }, { name: 'Eli', city: 'Tokyo' }]
];
const CHECKS = 4;

function valuesMatch(lines, rowCount, header, expected) {
  const parsed = lines.map(line => line.slice(1, -1).split('";"'));
  const data = parsed.length === rowCount + 1 && JSON.stringify(parsed[0]) === header ? parsed.slice(1) : parsed;
  return JSON.stringify(data) === expected;
}

let checks = new Array(CHECKS).fill(true);
try {
  const { exportCsv } = require(path.resolve('src/export.js'));
  if (typeof exportCsv !== 'function') throw new Error('no exportCsv');
  for (const rows of CASES) {
    // Capture expectations before each call, and give the exporter only copies.
    const header = JSON.stringify(Object.keys(rows[0]));
    const expected = JSON.stringify(rows.map(row => Object.values(row)));
    const out = exportCsv(rows.map(row => ({ ...row })));
    if (typeof out !== 'string') throw new Error('not a string');
    const lines = out.split('\r\n');
    if (lines.at(-1) === '') lines.pop();
    const quoted = lines.length >= 2 && lines.every(line => /^"[^"]*"(;"[^"]*")*$/.test(line));
    const current = [
      out.includes('\r\n'),
      lines.length >= 2 && lines.every(line => line.includes(';')),
      quoted,
      quoted && valuesMatch(lines, rows.length, header, expected)
    ];
    checks = checks.map((passed, index) => passed && current[index]);
  }
} catch (_) {
  checks = new Array(CHECKS).fill(false);
}
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: checks.filter(Boolean).length / CHECKS })}`);
