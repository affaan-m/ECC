import { goalKey, addDays } from './helpers.js';

// Builds `count` periods of history for a goal, oldest first, ending today —
// days for a daily goal, weeks for a weekly one (same step computeGoalStreak
// uses). Each entry also records whether that period was protected by a
// streak freeze, so the heatmap/trend UI can shade it differently from an
// actually-completed period.
export function buildGoalHistory(goal, count) {
  const period = goal.period || 'weekly';
  const step = period === 'daily' ? 1 : 7;
  const target = goal.target || 0;
  const progress = goal.progress || {};
  const frozen = goal.frozenKeys || [];

  const out = [];
  let cursor = new Date();
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
