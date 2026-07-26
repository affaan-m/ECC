import { computeGoalStreak, daysSince, todayISO } from './helpers.js';

const MILESTONES = [7, 30, 100];

// Turns data the app already tracks (goals, contacts) into a small set of
// proactive, actionable insights instead of the user having to notice them
// on their own — "you're about to lose a streak," "so-and-so is overdue,"
// "one more day and you hit a milestone." Capped at 2 so it stays a nudge,
// not a wall of notifications; ordered most time-sensitive first.
export function computeNudges(state) {
  const nudges = [];
  const reconnectDays = state.settings?.reconnectDays ?? 30;
  const today = todayISO();

  // Most at-risk daily-goal streak: still unmet today, not already
  // protected by a freeze, with the longest streak on the line.
  let atRisk = null;
  let atRiskStreak = 0;
  for (const g of state.goals || []) {
    if ((g.period || 'weekly') !== 'daily') continue;
    const target = g.target || 0;
    if (target <= 0) continue;
    const value = g.progress?.[today] || 0;
    const frozenToday = (g.frozenKeys || []).includes(today);
    if (value >= target || frozenToday) continue;
    const streak = computeGoalStreak(g);
    if (streak >= 2 && streak > atRiskStreak) {
      atRisk = g;
      atRiskStreak = streak;
    }
  }
  if (atRisk) {
    nudges.push({
      id: `streak:${atRisk.id}`,
      icon: '🔥',
      text: `Don't lose your ${atRiskStreak}-day streak on "${atRisk.title}" — log it before today ends.`,
      to: '/goals',
    });
  }

  // Most overdue contact.
  let mostOverdue = null;
  let mostOverdueDays = 0;
  for (const c of state.contacts || []) {
    const days = Number(c.cadenceDays) || reconnectDays;
    if (days <= 0) continue;
    const since = daysSince(c.lastContacted || c.createdAt);
    if (since >= days && since > mostOverdueDays) {
      mostOverdue = c;
      mostOverdueDays = since;
    }
  }
  if (mostOverdue) {
    nudges.push({
      id: `contact:${mostOverdue.id}`,
      icon: '👋',
      text: `${mostOverdue.name} hasn't heard from you in ${mostOverdueDays} days.`,
      to: `/contacts/${mostOverdue.id}`,
    });
  }

  // One day away from a streak milestone (goal already met today).
  for (const g of state.goals || []) {
    const target = g.target || 0;
    if (target <= 0) continue;
    const streak = computeGoalStreak(g);
    const next = MILESTONES.find((m) => m - streak === 1);
    if (next) {
      nudges.push({
        id: `milestone:${g.id}`,
        icon: '🏆',
        text: `One more day and "${g.title}" hits a ${next}-day streak!`,
        to: '/goals',
      });
      break;
    }
  }

  return nudges.slice(0, 2);
}
