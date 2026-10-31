'use strict';

const { parseDate } = require('../../src/dates');

function toRow(entry) {
  const p = parseDate(entry.date);
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y},${entry.amount}`;
}

module.exports = { toRow };
