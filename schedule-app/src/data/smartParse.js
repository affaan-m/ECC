import { todayISO, addDays, toISODate } from './helpers.js';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Finds the nearest day (today or later) whose weekday matches `dow`.
function nextWeekday(dow) {
  const today = new Date();
  const todayDow = today.getDay();
  const delta = (dow - todayDow + 7) % 7;
  return toISODate(addDays(today, delta));
}

// Parses free text like "call mom fri 3pm" or "dentist tomorrow at 9:30am"
// into { title, date, time } — date/time are null when nothing recognized,
// in which case it's just the typed text as a plain, undated task. Runs
// entirely offline (no API call) since this is a serverless PWA: a fixed set
// of deterministic patterns for weekdays, relative dates, and clock times,
// stripped out of the text to leave a clean title behind.
export function parseQuickAdd(text) {
  let remaining = text.trim();
  let date = null;
  let time = null;

  const strip = (re, replacement = '') => {
    const m = remaining.match(re);
    if (m) remaining = remaining.replace(re, replacement);
    return m;
  };

  // Relative day words.
  if (strip(/\btonight\b/i)) {
    date = todayISO();
    time = time || '19:00';
  } else if (strip(/\btomorrow\b/i)) {
    date = toISODate(addDays(new Date(), 1));
  } else if (strip(/\btoday\b/i)) {
    date = todayISO();
  } else if (strip(/\bnext week\b/i)) {
    date = toISODate(addDays(new Date(), 7));
  } else {
    // "in N day(s)" / "in N week(s)"
    const rel = remaining.match(/\bin\s+(\d+)\s+(day|days|week|weeks)\b/i);
    if (rel) {
      const n = Number(rel[1]);
      const days = /week/i.test(rel[2]) ? n * 7 : n;
      date = toISODate(addDays(new Date(), days));
      remaining = remaining.replace(rel[0], '');
    } else {
      // Weekday name, optionally preceded by "next" — treated as the
      // nearest upcoming occurrence either way (today counts if it matches).
      const wdRe = new RegExp(`\\b(?:next\\s+)?(${WEEKDAYS.join('|')}|${WEEKDAY_ABBR.join('|')})\\b`, 'i');
      const wd = remaining.match(wdRe);
      if (wd) {
        const name = wd[1].toLowerCase();
        const dow = WEEKDAYS.indexOf(name) >= 0 ? WEEKDAYS.indexOf(name) : WEEKDAY_ABBR.indexOf(name);
        date = nextWeekday(dow);
        remaining = remaining.replace(wd[0], '');
      }
    }
  }

  // Clock time: "3pm", "3:30 pm", "15:00".
  const ampm = remaining.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (/pm/i.test(ampm[3])) h += 12;
    const m = ampm[2] ? Number(ampm[2]) : 0;
    time = `${pad2(h)}:${pad2(m)}`;
    remaining = remaining.replace(ampm[0], '');
  } else {
    const clock = remaining.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (clock) {
      time = `${pad2(Number(clock[1]))}:${clock[2]}`;
      remaining = remaining.replace(clock[0], '');
    }
  }

  // Clean up leftover connector words and extra whitespace ("call mom at" → "call mom").
  const title = remaining
    .replace(/\b(at|on|by)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { title: title || text.trim(), date, time };
}
