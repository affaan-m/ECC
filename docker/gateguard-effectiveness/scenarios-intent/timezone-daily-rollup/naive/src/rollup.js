'use strict';

/** The trap taken: the UTC date the timestamp already carries. */
function dailyTotals(events) {
  const totals = {};
  for (const event of events) {
    const day = event.at.slice(0, 10);
    totals[day] = (totals[day] || 0) + event.amount;
  }
  return totals;
}

module.exports = { dailyTotals };
