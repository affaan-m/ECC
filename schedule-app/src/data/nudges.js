import { computeGoalStreak, daysSince, todayISO, fromISODate } from './helpers.js';
import { contactDatesWithin, contactDateLabel } from './contactDates.js';

const MILESTONES = [7, 30, 100];
// How far ahead a birthday/anniversary starts showing up as "coming up" —
// long enough to still be useful for buying a card or making plans, short
// enough that it isn't just background noise for most of the year.
const UPCOMING_DATE_WINDOW = 7;

// Turns data the app already tracks (goals, contacts) into a small set of
// proactive, actionable insights instead of the user having to notice them
// on their own — "you're about to lose a streak," "so-and-so is overdue,"
// "one more day and you hit a milestone." Capped at 3 so it stays a nudge,
// not a wall of notifications; ordered most time-sensitive first.
export function computeNudges(state) {
  const nudges = [];
  const reconnectDays = state.settings?.reconnectDays ?? 30;
  const today = todayISO();

  // A birthday or anniversary today outranks everything else here — it's
  // the one nudge with a hard deadline that can't be caught up on tomorrow.
  // Optional: off entirely when the setting is off, same as the fields
  // themselves being optional per contact.
  if (state.settings?.contactBirthdaysEnabled !== false) {
    const dates = contactDatesWithin(state.contacts || [], UPCOMING_DATE_WINDOW, today);
    const dueToday = dates.find((d) => d.nextDate === today);
    if (dueToday) {
      const { icon, text, detail } = contactDateLabel(dueToday);
      nudges.push({
        id: `date:${dueToday.id}`,
        icon,
        text: `${text} is today${detail ? ` — ${detail}` : ''}.`,
        to: `/contacts/${dueToday.contactId}`,
      });
    } else if (dates.length > 0) {
      const soon = dates[0];
      const days = Math.round((fromISODate(soon.nextDate) - fromISODate(today)) / 86400000);
      const { icon, text } = contactDateLabel(soon);
      nudges.push({
        id: `date:${soon.id}`,
        icon,
        text: `${text} is in ${days} day${days === 1 ? '' : 's'}.`,
        to: `/contacts/${soon.contactId}`,
      });
    }
  }

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
      icon: 'flame',
      text: `Don't lose your ${atRiskStreak}-day streak on "${atRisk.title}" — log it before today ends.`,
      to: '/goals',
    });
  }

  // Follow-ups you promised, due today or already missed. These outrank the
  // "haven't spoken in a while" nudge below on purpose: not having called
  // someone lately is a drift, but not calling when you said you would is a
  // broken commitment, and the app knows the difference.
  let dueFollowUp = null;
  let dueFollowUpDate = null;
  for (const c of state.contacts || []) {
    const date = c.followUp?.date;
    if (!date || date > today) continue;
    if (!dueFollowUpDate || date < dueFollowUpDate) {
      dueFollowUp = c;
      dueFollowUpDate = date;
    }
  }
  if (dueFollowUp) {
    const late = daysSince(dueFollowUpDate);
    nudges.push({
      id: `followup:${dueFollowUp.id}`,
      icon: 'personCheck',
      text:
        late > 0
          ? `You said you'd follow up with ${dueFollowUp.name} ${late} day${late === 1 ? '' : 's'} ago.`
          : `You said you'd follow up with ${dueFollowUp.name} today.`,
      to: `/contacts/${dueFollowUp.id}`,
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
      icon: 'personCheck',
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
        icon: 'trophy',
        text: `One more day and "${g.title}" hits a ${next}-day streak!`,
        to: '/goals',
      });
      break;
    }
  }

  return nudges.slice(0, 3);
}
