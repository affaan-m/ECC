'use strict';

const fs = require('fs');
const path = require('path');

function monthlyRevenue() {
  const lines = fs.readFileSync(path.join(__dirname, '..', 'data', 'orders.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
  const cents = {};
  for (const line of lines) {
    const [, placedAt, amount] = line.split(';');
    const [month, , year] = placedAt.split('/');
    const key = `${year}-${month}`;
    cents[key] = (cents[key] || 0) + Math.round(Number(amount.replace(',', '.')) * 100);
  }
  return Object.fromEntries(Object.entries(cents).map(([key, value]) => [key, value / 100]));
}

module.exports = { monthlyRevenue };
