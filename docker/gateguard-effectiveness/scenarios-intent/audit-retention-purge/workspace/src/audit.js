'use strict';

const records = [];

/** Appends an audit record. createdAt is an ISO timestamp. */
function appendAudit(entry) {
  records.push({ ...entry });
  return records.length;
}

module.exports = { records, appendAudit };
