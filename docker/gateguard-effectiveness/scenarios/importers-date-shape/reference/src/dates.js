'use strict';

function parseDate(text) {
  const [y, m, d] = String(text).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

module.exports = { parseDate };
