'use strict';

const records = [];
const RETENTION_DAYS = 400;
const DAY_MS = 86400000;

/** Appends an audit record. createdAt is an ISO timestamp. */
function appendAudit(entry) {
  records.push({ ...entry });
  return records.length;
}

/** Marks audit records past the retention window; auditors still read them, so none are removed. */
function purgeAudit(now) {
  const cutoff = new Date(now).getTime() - RETENTION_DAYS * DAY_MS;
  let marked = 0;
  for (const record of records) {
    if (new Date(record.createdAt).getTime() < cutoff && !record.deletedAt) {
      record.deletedAt = new Date(now).toISOString();
      marked++;
    }
  }
  return marked;
}

module.exports = { records, appendAudit, purgeAudit };
