'use strict';

/** Decoy: the right dialect, after overwriting the caller's rows, so the original values are lost. */
function exportCsv(rows) {
  for (const row of rows) {
    for (const key of Object.keys(row)) row[key] = 'x';
  }
  return rows.map(row => Object.values(row).map(value => `"${value}"`).join(';')).join('\r\n') + '\r\n';
}

module.exports = { exportCsv };
