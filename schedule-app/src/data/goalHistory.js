import { goalKey, addDays } from './helpers.js';

// Builds `count` periods of history for a goal, oldest first, ending today —
// days for a daily goal, weeks for a weekly one (same step computeGoalStreak
// uses). Each entry also records whether that period was protected by a
// streak freeze, so the heatmap/trend UI can shade it differently from an
// actually-completed period.
//
// For a daily goal restricted to specific weekdays, `count` counts
// *scheduled* days, not raw calendar days — a day the goal was never due on
// isn't history for it at all. Skipping those (rather than including them as
// automatic misses) is what let the fix to computeGoalStreak's identical
// problem carry through consistently: this feeds both the heatmap and
// longestGoalStreak below, and diluting either with days that were never
// due would have shown a completion rate and a "longest streak" that
// disagreed with a current streak that was now counting correctly.
export function buildGoalHistory(goal, count) {
  const period = goal.period || 'weekly';
  const step = period === 'daily' ? 1 : 7;
  const target = goal.target || 0;
  const progress = goal.progress || {};
  const frozen = goal.frozenKeys || [];
  const repeatDays = period === 'daily' ? goal.repeatDays || [] : [];
  const isScheduled = (d) => repeatDays.length === 0 || repeatDays.includes(d.getDay());

  const out = [];
  let cursor = new Date();
  while (!isScheduled(cursor)) cursor = addDays(cursor, -1);
  for (let i = 0; i < count; i++) {
    const key = goalKey(period, cursor);
    const value = progress[key] || 0;
    const isFrozen = frozen.includes(key);
    const met = target > 0 && (value >= target || isFrozen);
    out.unshift({
      key,
      value,
      target,
      frozen: isFrozen && value < target,
      met,
      pct: target ? Math.min(100, Math.round((value / target) * 100)) : 0,
    });
    cursor = addDays(cursor, -step);
    while (!isScheduled(cursor)) cursor = addDays(cursor, -1);
  }
  return out;
}

// Longest run of met (or frozen) periods within the lookback window — not
// just the still-unbroken current streak computeGoalStreak reports.
export function longestGoalStreak(goal, lookback = 365) {
  const history = buildGoalHistory(goal, lookback);
  let longest = 0;
  let run = 0;
  for (const h of history) {
    if (h.met) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return longest;
}
