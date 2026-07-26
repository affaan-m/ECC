import { startOfWeek, addDays, toISODate, fromISODate, goalKey, todayISO } from './helpers.js';

// Summarizes "this week so far" (calendar week, respecting the Monday/Sunday
// start setting) across goals, contacts, and tasks — three things the app
// already tracks — into a single motivating digest instead of making the
// user piece it together from three separate pages.
export function computeWeeklyRecap(state) {
  const weekStartDate = startOfWeek(new Date());
  const days = Array.from({ length: 7 }, (_, i) => toISODate(addDays(weekStartDate, i)));
  const today = todayISO();
  const elapsedDays = days.filter((d) => d <= today);

  let goalsCompleted = 0;
  let goalsPossible = 0;
  for (const g of state.goals || []) {
    const target = g.target || 0;
    if (target <= 0) continue;
    const frozen = g.frozenKeys || [];
    if ((g.period || 'weekly') === 'daily') {
      for (const d of elapsedDays) {
        if (g.repeatDays?.length && !g.repeatDays.includes(fromISODate(d).getDay())) continue;
        goalsPossible++;
        const value = g.progress?.[d] || 0;
        if (value >= target || frozen.includes(d)) goalsCompleted++;
      }
    } else {
      goalsPossible++;
      const key = goalKey('weekly', weekStartDate);
      const value = g.progress?.[key] || 0;
      if (value >= target || frozen.includes(key)) goalsCompleted++;
    }
  }

  const contactsReconnected = (state.contacts || []).filter((c) => days.includes(c.lastContacted)).length;
  const tasksCompleted = (state.tasks || []).reduce(
    (sum, t) => sum + (t.completedDates || []).filter((d) => days.includes(d)).length,
    0
  );

  return {
    weekStart: days[0],
    weekEnd: days[6],
    goalsCompleted,
    goalsPossible,
    contactsReconnected,
    tasksCompleted,
  };
}
