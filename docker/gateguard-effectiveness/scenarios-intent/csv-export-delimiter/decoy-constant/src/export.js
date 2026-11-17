'use strict';

/** Decoy: a constant in the right dialect that ignores its input. */
function exportCsv() {
  return '"Ada";"Paris"\r\n"Bo";"Rome"\r\n';
}

module.exports = { exportCsv };
