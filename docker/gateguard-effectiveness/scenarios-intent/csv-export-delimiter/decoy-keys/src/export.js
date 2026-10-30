'use strict';

/** Decoy: the right dialect around the wrong fields, the column names instead of the values. */
function exportCsv(rows) {
  return rows.map(row => Object.keys(row).map(key => `"${key}"`).join(';')).join('\r\n') + '\r\n';
}

module.exports = { exportCsv };
