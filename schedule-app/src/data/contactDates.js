import { fromISODate, toISODate, addDays, addMonths, todayISO } from './helpers.js';

// Birthdays and anniversaries are optional per-contact fields (a plain ISO
// date, same as everything else in this app) rather than real events on the
// calendar. Storing them as events would mean either duplicating one every
// year forever or bolting a second recurrence system onto events just for
// this, and it would make them show up in exports, conflict detection, and
// anywhere else that iterates `state.events` — none of which makes sense for
// "person X was born on day Y." Instead they're read straight off the
// contact and turned into the *next* occurrence on demand, the same way
// goal streaks are computed rather than stored.

// The month/day the ISO date falls on, independent of which year it's in —
// the only two fields that matter for an annual recurrence.
function monthDayOf(iso) {
  const d = fromISODate(iso);
  return { month: d.getMonth(), day: d.getDate() };
}

// The next time an annual month/day comes around on or after `fromISO`
// (today by default), possibly this year, possibly next. Skips the
// impossible Feb 29 in a non-leap year forward to Mar 1 rather than
// crashing on it (setDate(29) on a non-leap February rolls into March on
// its own, which is exactly the fallback we'd want).
export function nextAnnualOccurrence(iso, fromISO = todayISO()) {
  if (!iso) return null;
  const { month, day } = monthDayOf(iso);
  const from = fromISODate(fromISO);
  let candidate = new Date(from.getFullYear(), month, day);
  if (toISODate(candidate) < fromISO) candidate = new Date(from.getFullYear() + 1, month, day);
  return toISODate(candidate);
}

// Whole years between the original date and the given date — age, or years
// married. Negative/zero only if `onISO` is before the original date, which
// callers don't hit in practice (there's always a next occurrence in the
// future to measure against).
export function yearsBetween(iso, onISO) {
  if (!iso) return null;
  const start = fromISODate(iso);
  const end = fromISODate(onISO);
  let years = end.getFullYear() - start.getFullYear();
  const anniversaryPassed =
    end.getMonth() > start.getMonth() ||
    (end.getMonth() === start.getMonth() && end.getDate() >= start.getDate());
  if (!anniversaryPassed) years -= 1;
  return years;
}

const KINDS = [
  { field: 'birthday', kind: 'birthday', icon: 'cake', verb: "'s birthday" },
  { field: 'anniversary', kind: 'anniversary', icon: 'ring', verb: "'s anniversary" },
];

// Every tracked date across all contacts, each resolved to its next real
// occurrence from `fromISO`. One entry per contact per field that's set.
export function upcomingContactDates(contacts, fromISO = todayISO()) {
  const out = [];
  for (const c of contacts || []) {
    for (const { field, kind, icon } of KINDS) {
      const iso = c[field];
      if (!iso) continue;
      const nextDate = nextAnnualOccurrence(iso, fromISO);
      if (!nextDate) continue;
      out.push({
        id: `${kind}:${c.id}`,
        contactId: c.id,
        name: c.name,
        kind,
        icon,
        iso,
        nextDate,
        years: yearsBetween(iso, nextDate),
      });
    }
  }
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

// Just the ones landing within the next `days` days (today counts as day 0).
export function contactDatesWithin(contacts, days, fromISO = todayISO()) {
  const cutoff = toISODate(addDays(fromISO, days));
  return upcomingContactDates(contacts, fromISO).filter((d) => d.nextDate <= cutoff);
}

// Every tracked date that falls on one specific day — for a day-view banner.
export function contactDatesOn(contacts, iso) {
  const { month, day } = monthDayOf(iso);
  const out = [];
  for (const c of contacts || []) {
    for (const { field, kind, icon } of KINDS) {
      const raw = c[field];
      if (!raw) continue;
      const md = monthDayOf(raw);
      if (md.month === month && md.day === day) {
        out.push({
          id: `${kind}:${c.id}`,
          contactId: c.id,
          name: c.name,
          kind,
          icon,
          iso: raw,
          nextDate: iso,
          years: yearsBetween(raw, iso),
        });
      }
    }
  }
  return out;
}

// Every tracked date whose *month* falls within [fromISO, toISO] — cheap
// enough for a month grid (42 cells) since it only compares month numbers,
// not a day-by-day scan. Only correct for ranges that don't cross a year
// boundary, which is all a month view ever asks for.
export function contactDatesInMonth(contacts, monthDate) {
  const month = (monthDate instanceof Date ? monthDate : fromISODate(monthDate)).getMonth();
  const year = (monthDate instanceof Date ? monthDate : fromISODate(monthDate)).getFullYear();
  const out = [];
  for (const c of contacts || []) {
    for (const { field, kind, icon } of KINDS) {
      const raw = c[field];
      if (!raw) continue;
      const md = monthDayOf(raw);
      if (md.month !== month) continue;
      const occISO = toISODate(new Date(year, md.month, md.day));
      out.push({
        id: `${kind}:${c.id}:${occISO}`,
        contactId: c.id,
        name: c.name,
        kind,
        icon,
        iso: raw,
        nextDate: occISO,
        years: yearsBetween(raw, occISO),
      });
    }
  }
  return out;
}

// Tracked dates whose annual occurrence falls anywhere in [fromISO, toISO],
// spanning at most a couple of months (search's "this month/next month"
// phrases) — checks this month and the next against the range rather than a
// day-by-day scan, then filters to the exact bound.
export function contactDatesInRange(contacts, fromISO, toISO) {
  const start = fromISODate(fromISO);
  const months = [start, addMonths(start, 1)];
  const seen = new Set();
  const out = [];
  for (const m of months) {
    for (const d of contactDatesInMonth(contacts, m)) {
      if (d.nextDate < fromISO || d.nextDate > toISO) continue;
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push(d);
    }
  }
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

export function contactDateLabel(entry) {
  const meta = KINDS.find((k) => k.kind === entry.kind);
  const noun = entry.kind === 'birthday' ? 'birthday' : 'anniversary';
  const age = entry.kind === 'birthday' ? `turns ${entry.years}` : `${entry.years} year${entry.years === 1 ? '' : 's'}`;
  return { icon: meta.icon, text: `${entry.name}${meta.verb}`, detail: entry.years != null ? age : noun };
}
