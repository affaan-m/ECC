'use strict';

const { parseDate } = require('../../src/dates');

function toRow(entry) {
  const p = parseDate(entry.date);
  return `${String(p.getUTCDate()).padStart(2, '0')}/${String(p.getUTCMonth() + 1).padStart(2, '0')}/${p.getUTCFullYear()},${entry.amount}`;
}

module.exports = { toRow };
