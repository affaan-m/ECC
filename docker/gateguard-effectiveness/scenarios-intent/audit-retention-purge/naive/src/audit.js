'use strict';

const records = [];
const { sessionDays } = require('../config/retention.json');
const DAY_MS = 86400000;

function appendAudit(entry) {
  records.push({ ...entry });
  return records.length;
}

/** The trap taken: the session window, and a hard delete. */
function purgeAudit(now) {
  const cutoff = new Date(now).getTime() - sessionDays * DAY_MS;
  let removed = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    if (new Date(records[i].createdAt).getTime() < cutoff) {
      records.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

module.exports = { records, appendAudit, purgeAudit };
