'use strict';

const { parseDate } = require('./dates');

function dueDate(issued, days) {
  const p = parseDate(issued);
  return new Date(p.getTime() + days * 86400000).toISOString().slice(0, 10);
}

module.exports = { dueDate };
