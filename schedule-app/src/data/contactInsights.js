import { fromISODate, timeToMinutes } from './helpers.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// What the record of a relationship can tell you that you'd otherwise have to
// count by hand.
//
// A timeline shows what happened; these say what usually happens. "You mostly
// see Maria on Saturday mornings" is the kind of thing you know about the
// people you're closest to and can't hold in your head for thirty others —
// and it's exactly what you want when you're deciding when to suggest
// meeting.
//
// Everything is derived from entries already on the timeline (events and
// logged contact), so there's nothing extra to record and no setting to turn
// on. Each finding is suppressed unless there's enough behind it to be worth
// stating: two occurrences prove nothing about a pattern.

// Below this, a "usually" claim is just noise.
const MIN_FOR_PATTERN = 5;
// And the winner has to appear at least this many times in its own right —
// "usually a Sunday, 2 of 5 times" clears a 40% share while resting on two
// data points, which is a coincidence dressed up as a habit.
const MIN_OCCURRENCES = 3;
// A day or part-of-day has to actually dominate, not merely lead a three-way
// split, before it's worth calling a habit.
const DOMINANCE = 0.4;

export function contactInsights(entries, { now = new Date() } = {}) {
  const past = entries.filter((e) => e.date <= toISO(now));
  if (past.length === 0) return [];

  const out = [];
  const dayCounts = new Array(7).fill(0);
  const parts = { morning: 0, afternoon: 0, evening: 0 };
  let timed = 0;

  for (const e of past) {
    dayCounts[fromISODate(e.date).getDay()] += 1;
    const start = e.type === 'event' ? e.occ?.start : null;
    if (start) {
      timed += 1;
      const mins = timeToMinutes(start);
      if (mins < 12 * 60) parts.morning += 1;
      else if (mins < 17 * 60) parts.afternoon += 1;
      else parts.evening += 1;
    }
  }

  // --- When you usually see them ------------------------------------------
  if (past.length >= MIN_FOR_PATTERN) {
    const topDay = dayCounts.indexOf(Math.max(...dayCounts));
    if (dayCounts[topDay] >= MIN_OCCURRENCES && dayCounts[topDay] / past.length >= DOMINANCE) {
      const part = topPart(parts, timed);
      out.push({
        id: 'when',
        icon: 'clock',
        text: part
          ? `Usually ${DAYS[topDay]} ${part}s — ${dayCounts[topDay]} of ${past.length} times.`
          : `Usually a ${DAYS[topDay]} — ${dayCounts[topDay]} of ${past.length} times.`,
      });
    } else {
      const part = topPart(parts, timed);
      if (part) out.push({ id: 'when', icon: 'clock', text: `Usually in the ${part}.` });
    }
  }

  // --- How often ----------------------------------------------------------
  // Median gap rather than mean: one six-month silence shouldn't turn a
  // fortnightly friendship into a quarterly one.
  const dates = [...new Set(past.map((e) => e.date))].sort();
  if (dates.length >= 3) {
    const gaps = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push(Math.round((fromISODate(dates[i]) - fromISODate(dates[i - 1])) / 86400000));
    }
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median > 0) {
      out.push({ id: 'cadence', icon: 'repeat', text: `About every ${describeGap(median)}.` });
    }
  }

  // --- How long it's been -------------------------------------------------
  const last = dates[dates.length - 1];
  if (last) {
    const days = Math.round((stripTime(now) - fromISODate(last)) / 86400000);
    out.push({
      id: 'last',
      icon: 'personCheck',
      text:
        days <= 0
          ? 'Last connected today.'
          : `Last connected ${days} day${days === 1 ? '' : 's'} ago.`,
    });
  }

  // --- Where ---------------------------------------------------------------
  const places = {};
  for (const e of past) {
    const loc = e.type === 'event' ? (e.occ?.location || '').trim() : '';
    if (loc) places[loc] = (places[loc] || 0) + 1;
  }
  const topPlace = Object.entries(places).sort((a, b) => b[1] - a[1])[0];
  if (topPlace && topPlace[1] >= 2) {
    out.push({ id: 'where', icon: 'pin', text: `Most often at ${topPlace[0]}.` });
  }

  return out;
}

function topPart(parts, timed) {
  if (timed < MIN_FOR_PATTERN) return null;
  const [name, n] = Object.entries(parts).sort((a, b) => b[1] - a[1])[0];
  return n >= MIN_OCCURRENCES && n / timed >= DOMINANCE ? name : null;
}

function describeGap(days) {
  if (days <= 2) return `${days} day${days === 1 ? '' : 's'}`;
  if (days <= 10) return `${days} days`;
  if (days <= 24) return `${Math.round(days / 7)} weeks`;
  const months = Math.round(days / 30);
  return months <= 1 ? 'month' : `${months} months`;
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toISO(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
