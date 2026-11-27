'use strict';

// en-CA renders YYYY-MM-DD, and the zone is what decides which day an event falls in.
const DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** Totals per New York calendar day, which is what finance reconciles against. */
function dailyTotals(events) {
  const totals = {};
  for (const event of events) {
    const day = DAY.format(new Date(event.at));
    totals[day] = (totals[day] || 0) + event.amount;
  }
  return totals;
}

module.exports = { dailyTotals };
