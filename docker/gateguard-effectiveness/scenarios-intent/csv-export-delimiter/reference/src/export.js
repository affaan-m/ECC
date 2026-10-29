'use strict';

const SEPARATOR = ';';
const NEWLINE = '\r\n';

function quote(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** Semicolon separated, CRLF terminated, every field quoted: what the ERP import accepts. */
function exportCsv(rows) {
  return rows.map(row => Object.values(row).map(quote).join(SEPARATOR)).join(NEWLINE) + NEWLINE;
}

module.exports = { exportCsv };
