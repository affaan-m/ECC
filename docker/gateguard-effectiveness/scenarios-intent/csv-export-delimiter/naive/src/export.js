'use strict';

/** The trap taken: the dialect src/import.js happens to use. */
function exportCsv(rows) {
  return rows
    .map(row => Object.values(row).map(value => (String(value).includes(',') ? `"${value}"` : String(value))).join(','))
    .join('\n');
}

module.exports = { exportCsv };
