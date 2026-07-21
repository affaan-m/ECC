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

// Monday-based start of week for the given date.
export function startOfWeek(date) {
  const d = date instanceof Date ? new Date(date) : fromISODate(date);
  const day = (d.getDay() + 6) % 7; // 0 = Monday
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

export function isToday(iso) {
  return iso === todayISO();
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

export function formatTime(hhmm) {
  const mins = timeToMinutes(hhmm);
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h} ${ampm}` : `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}
