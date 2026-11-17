'use strict';

const { parseDate } = require('./dates');

function monthOf(row) {
  const p = parseDate(row.date);
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}`;
}

function totalsByMonth(rows) {
  const totals = {};
  for (const row of rows) totals[monthOf(row)] = (totals[monthOf(row)] || 0) + row.amount;
  return totals;
}

module.exports = { monthOf, totalsByMonth };
