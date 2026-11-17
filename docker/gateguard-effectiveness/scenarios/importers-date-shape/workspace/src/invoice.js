'use strict';

const { parseDate } = require('./dates');

function dueDate(issued, days) {
  const p = parseDate(issued);
  return new Date(Date.UTC(p.y, p.m - 1, p.d + days)).toISOString().slice(0, 10);
}

module.exports = { dueDate };
