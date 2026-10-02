'use strict';

function parseDate(text) {
  const [y, m, d] = String(text).split('-').map(Number);
  return { y, m, d };
}

module.exports = { parseDate };
