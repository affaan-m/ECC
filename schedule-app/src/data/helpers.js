// Small, dependency-free helpers for ids, dates, and time math.

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// --- Dates -----------------------------------------------------------------

// Format a Date as a local YYYY-MM-DD string (avoids UTC off-by-one).
export function toISODate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO() {
  return toISODate(new Date());
}

// Parse a YYYY-MM-DD string as a local Date at midnight.
export function fromISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, n) {
  const d = date instanceof Date ? new Date(date) : fromISODate(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Start of week for the given date — Monday by default, or Sunday when
// setSundayWeekStart(true) has been called (see More → Calendar settings).
export function startOfWeek(date) {
  const d = date instanceof Date ? new Date(date) : fromISODate(date);
  const day = sundayWeekStart ? d.getDay() : (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

// A week is keyed by the ISO date of its Monday.
export function weekKey(date) {
  return toISODate(startOfWeek(date));
}

export function weekDays(weekStart) {
  const start = weekStart instanceof Date ? weekStart : fromISODate(weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function addMonths(date, n) {
  const d = date instanceof Date ? new Date(date) : fromISODate(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  // Clamp so e.g. Jan 31 + 1 month doesn't overflow into March.
  const daysInTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInTarget));
  return d;
}

export function startOfMonth(date) {
  const d = date instanceof Date ? new Date(date) : fromISODate(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// A 6x7 grid of Dates covering the given month, padded with the trailing
// days of the previous month and leading days of the next so every row is a
// full Monday-start week.
export function monthGrid(monthStart) {
  const start = monthStart instanceof Date ? monthStart : startOfMonth(monthStart);
  const gridStart = startOfWeek(start);
  const weeks = [];
  let cursor = gridStart;
  for (let w = 0; w < 6; w++) {
    weeks.push(weekDays(cursor));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTH = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function formatDayLabel(date) {
  const d = date instanceof Date ? date : fromISODate(date);
  return `${WEEKDAY_LONG[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`;
}

export function formatShortDate(date) {
  const d = date instanceof Date ? date : fromISODate(date);
  return `${MONTH[d.getMonth()]} ${d.getDate()}`;
}

export function formatWeekRange(weekStart) {
  const start = weekStart instanceof Date ? weekStart : fromISODate(weekStart);
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const left = `${MONTH[start.getMonth()]} ${start.getDate()}`;
  const right = sameMonth
    ? `${end.getDate()}`
    : `${MONTH[end.getMonth()]} ${end.getDate()}`;
  return `${left} – ${right}`;
}

export function weekdayShort(date) {
  const d = date instanceof Date ? date : fromISODate(date);
  return WEEKDAY[d.getDay()];
}

const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatMonthLabel(date) {
  const d = date instanceof Date ? date : fromISODate(date);
  return `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

export function isToday(iso) {
  return iso === todayISO();
}

// Whole days between an ISO date and today (Infinity when no date).
export function daysSince(iso) {
  if (!iso) return Infinity;
  return Math.floor((fromISODate(todayISO()) - fromISODate(iso)) / 86400000);
}

// Human "time ago" for a YYYY-MM-DD contact date.
export function daysAgoLabel(iso) {
  if (!iso) return 'Never';
  const diff = Math.round(
    (fromISODate(todayISO()) - fromISODate(iso)) / 86400000
  );
  if (diff < 0) return formatShortDate(iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff} days ago`;
  if (diff < 14) return 'Last week';
  if (diff < 30) return `${Math.floor(diff / 7)} weeks ago`;
  if (diff < 60) return 'Last month';
  return `${Math.floor(diff / 30)} months ago`;
}

// --- Time-of-day -----------------------------------------------------------

export function timeToMinutes(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// App-wide time/week display prefs, kept in sync from settings by App.jsx.
// Module-level rather than threaded through every formatTime/startOfWeek
// call site (there are a couple dozen across the app).
let use24hFormat = false;
export function setUse24hFormat(v) {
  use24hFormat = !!v;
}
let sundayWeekStart = false;
export function setSundayWeekStart(v) {
  sundayWeekStart = !!v;
}

export function formatTime(hhmm) {
  const mins = timeToMinutes(hhmm);
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  if (use24hFormat) {
    return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  let h = h24 % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h} ${ampm}` : `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Up to two initials from a display name, for avatar chips.
export function initials(name) {
  return (name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

// --- Geo --------------------------------------------------------------------

// Great-circle distance between two lat/lng points, in meters (haversine).
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// --- Goals -----------------------------------------------------------------

// The progress key for a goal in a given date context: daily goals track by
// day, weekly goals by the week's Monday.
export function goalKey(period, date) {
  return period === 'daily' ? toISODate(date) : weekKey(date);
}

// How many consecutive days (daily goals) or weeks (weekly goals) this goal
// has been met, counting back from now. Today/this week doesn't have to be
// met yet for the streak to still count — an unfinished-but-not-over period
// shouldn't zero out an otherwise-alive streak, so counting starts from
// yesterday/last week instead when the current one isn't done yet. A period
// listed in goal.frozenKeys counts as met even if its target wasn't hit —
// that's a manually-spent streak freeze protecting a missed day.
export function computeGoalStreak(goal) {
  const target = goal.target || 0;
  if (target <= 0) return 0;
  const progress = goal.progress || {};
  const frozen = goal.frozenKeys || [];
  const period = goal.period || 'weekly';
  const step = period === 'daily' ? 1 : 7;
  const met = (d) => {
    const key = goalKey(period, d);
    return (progress[key] || 0) >= target || frozen.includes(key);
  };

  let cursor = new Date();
  if (!met(cursor)) cursor = addDays(cursor, -step);
  let count = 0;
  while (met(cursor)) {
    count++;
    cursor = addDays(cursor, -step);
  }
  return count;
}

// Streak freezes reset monthly rather than being a lifetime pool — Pro gets
// a bigger monthly allowance ("streak insurance") as one of the perks of the
// subscription. Usage is derived from the dates already recorded in
// goal.frozenKeys rather than a separate decrementing counter, so it just
// naturally rolls over into a fresh quota each month.
export const FREE_MONTHLY_FREEZES = 2;
export const PRO_MONTHLY_FREEZES = 5;
export function goalFreezesLeft(goal, isPro) {
  const quota = isPro ? PRO_MONTHLY_FREEZES : FREE_MONTHLY_FREEZES;
  const thisMonth = todayISO().slice(0, 7); // 'YYYY-MM'
  const used = (goal.frozenKeys || []).filter((k) => k.slice(0, 7) === thisMonth).length;
  return Math.max(0, quota - used);
}

// --- Recurring events ------------------------------------------------------

export const REPEAT_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Every month' },
  { value: 'custom', label: 'Custom days' },
];

export const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function repeatLabel(value, repeatDays) {
  if (value === 'custom' && repeatDays?.length) {
    return repeatDays
      .slice()
      .sort()
      .map((d) => WEEKDAY_ABBR[d])
      .join(', ');
  }
  return REPEAT_OPTIONS.find((o) => o.value === value)?.label || 'Does not repeat';
}

// Does an event occur on the given ISO date, honoring its repeat rule,
// end date, and per-occurrence skips?
export function occursOn(event, iso) {
  const repeat = event.repeat || 'none';
  if (repeat === 'none') return event.date === iso;
  if (iso < event.date) return false;
  if (event.repeatUntil && iso > event.repeatUntil) return false;
  if ((event.skipDates || []).includes(iso)) return false;
  const start = fromISODate(event.date);
  const day = fromISODate(iso);
  const diff = Math.round((day - start) / 86400000);
  switch (repeat) {
    case 'daily':
      return true;
    case 'weekly':
      return diff % 7 === 0;
    case 'biweekly':
      return diff % 14 === 0;
    case 'monthly':
      return start.getDate() === day.getDate();
    case 'custom':
      return (event.repeatDays || []).includes(day.getDay());
    default:
      return false;
  }
}

// Is a specific occurrence marked done? Single events use the `done` flag;
// recurring events track completed dates in `doneDates`.
export function isOccurrenceDone(event, iso) {
  if ((event.repeat || 'none') === 'none') return !!event.done;
  return (event.doneDates || []).includes(iso);
}

// Pure recurrence-rule test (anchor / end date / frequency), ignoring skips
// and per-occurrence overrides.
export function matchesRule(event, iso) {
  const repeat = event.repeat || 'none';
  if (repeat === 'none') return event.date === iso;
  if (iso < event.date) return false;
  if (event.repeatUntil && iso > event.repeatUntil) return false;
  const start = fromISODate(event.date);
  const day = fromISODate(iso);
  const diff = Math.round((day - start) / 86400000);
  switch (repeat) {
    case 'daily':
      return true;
    case 'weekly':
      return diff % 7 === 0;
    case 'biweekly':
      return diff % 14 === 0;
    case 'monthly':
      return start.getDate() === day.getDate();
    case 'custom':
      return (event.repeatDays || []).includes(day.getDay());
    default:
      return false;
  }
}

// Build a display occurrence, merging any per-occurrence override on top of
// the master event. `recDate` is the recurrence id (original rule date);
// `occDate` is where it actually shows (an override may relocate it).
function makeOccurrence(event, recDate, occDate, ov) {
  const repeat = event.repeat || 'none';
  return {
    ...event,
    recDate,
    occDate,
    // Pristine master fields, kept so an "edit all" can reset to the series base.
    base: {
      title: event.title,
      start: event.start,
      end: event.end,
      contactId: event.contactId || '',
      location: event.location || '',
      notes: event.notes || '',
      date: event.date,
    },
    title: ov?.title ?? event.title,
    start: ov?.start ?? event.start,
    end: ov?.end ?? event.end,
    contactId: ov?.contactId ?? event.contactId ?? '',
    location: ov?.location ?? event.location ?? '',
    notes: ov?.notes ?? event.notes ?? '',
    done: repeat === 'none' ? !!event.done : (event.doneDates || []).includes(recDate),
    isException: !!ov,
  };
}

// All occurrences of an event that DISPLAY on the given day. Usually 0 or 1,
// but an override can relocate an occurrence from another day onto this one.
export function expandEventOnDay(event, iso) {
  const repeat = event.repeat || 'none';
  if (repeat === 'none') {
    return event.date === iso ? [makeOccurrence(event, iso, iso, null)] : [];
  }
  const overrides = event.overrides || {};
  const skip = event.skipDates || [];
  const out = [];
  // In-place occurrence on its own rule date (unless moved elsewhere).
  if (matchesRule(event, iso) && !skip.includes(iso)) {
    const ov = overrides[iso];
    if (!ov || !ov.date || ov.date === iso) out.push(makeOccurrence(event, iso, iso, ov || null));
  }
  // Occurrences relocated onto this day from a different rule date.
  for (const rec of Object.keys(overrides)) {
    const ov = overrides[rec];
    if (ov && ov.date === iso && rec !== iso && matchesRule(event, rec) && !skip.includes(rec)) {
      out.push(makeOccurrence(event, rec, iso, ov));
    }
  }
  return out;
}
