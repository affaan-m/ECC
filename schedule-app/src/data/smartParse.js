import { todayISO, addDays, toISODate } from './helpers.js';

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const WEEKDAY_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Finds the nearest day (today or later) whose weekday matches `dow`.
// Exported — search's date-phrase parser (data/nlSearch.js) recognizes the
// same weekday words and wants exactly this "nearest upcoming" reading
// rather than a second, possibly-diverging implementation of it.
export function nextWeekday(dow) {
  const today = new Date();
  const todayDow = today.getDay();
  const delta = (dow - todayDow + 7) % 7;
  return toISODate(addDays(today, delta));
}

// Turns an hour + optional am/pm into 24-hour. With no meridiem anywhere to
// go on, it guesses the way people actually write times: 1–6 means afternoon,
// 7–11 means morning, 12 means midday. Anything 13+ is already 24-hour.
function resolveHour(h, meridiem, inherited) {
  const mer = meridiem || inherited;
  if (mer) {
    const base = h % 12;
    return /p/i.test(mer) ? base + 12 : base;
  }
  if (h === 0 || h > 12) return h;
  if (h === 12) return 12;
  return h <= 6 ? h + 12 : h;
}

const RANGE_RE =
  /\b(?:from\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|—|to|until|till|til)\s*(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i;

// Parses free text like "call mom fri 3pm", "dentist tomorrow at 9:30am" or
// "lunch with Sam 12-1:30pm" into { title, date, time, endTime } — each of
// date/time/endTime is null when nothing was recognized, in which case it's
// just the typed text as a plain, undated task. Runs entirely offline (no API
// call) since this is a serverless PWA: a fixed set of deterministic patterns
// for weekdays, relative dates, and clock times, stripped out of the text to
// leave a clean title behind.
export function parseQuickAdd(text) {
  let remaining = text.trim();
  let date = null;
  let time = null;
  let endTime = null;

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

  // A range first — "3-5pm", "9:30 to 11", "from 2pm until 4pm". Matching the
  // whole thing in one go is what keeps the title clean: the connector and
  // both meridiems come out with it, instead of "to 5pm" being left behind
  // as part of the title.
  const range = remaining.match(RANGE_RE);
  if (range) {
    const [, h1, m1, mer1, h2, m2, mer2] = range;
    // An unmarked endpoint borrows the other's am/pm — "3-5pm" means both are
    // afternoon, and "9am-12" runs to midday.
    let start = resolveHour(Number(h1), mer1, mer2);
    let end = resolveHour(Number(h2), mer2, mer1);
    const startMins = start * 60 + (m1 ? Number(m1) : 0);
    let endMins = end * 60 + (m2 ? Number(m2) : 0);
    // "11-1" reads as crossing midday, not as going backwards in time.
    if (endMins <= startMins && end + 12 <= 23) endMins += 12 * 60;
    if (endMins > startMins) {
      time = `${pad2(Math.floor(startMins / 60))}:${pad2(startMins % 60)}`;
      endTime = `${pad2(Math.floor(endMins / 60))}:${pad2(endMins % 60)}`;
      remaining = remaining.replace(range[0], ' ');
    }
  }

  if (!time) {
    // Single clock time: "3pm", "3:30 pm", "15:00". Deliberately requires a
    // meridiem or a colon — a bare number is far more likely to belong to the
    // title ("Chapter 3", "Route 66") than to be a time.
    const ampm = remaining.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)\b/i);
    if (ampm) {
      const h = resolveHour(Number(ampm[1]), ampm[3]);
      const m = ampm[2] ? Number(ampm[2]) : 0;
      time = `${pad2(h)}:${pad2(m)}`;
      remaining = remaining.replace(ampm[0], ' ');
    } else {
      const clock = remaining.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
      if (clock) {
        time = `${pad2(Number(clock[1]))}:${clock[2]}`;
        remaining = remaining.replace(clock[0], ' ');
      }
    }
  }

  let title = remaining;
  // A meridiem only ever survives here if it got separated from its number by
  // something the patterns above didn't cover, so it's safe to drop — but
  // only when a time was actually found, so a title that just happens to
  // contain "am" is left alone.
  if (time) title = title.replace(/\b(am|pm|a\.m\.|p\.m\.)\b/gi, ' ');
  title = title
    .replace(/\s{2,}/g, ' ')
    .trim()
    // Connectors orphaned by removing what followed them ("lunch with Sam at").
    .replace(/\s+\b(at|on|by|from|to|until|till|til)\b\s*$/i, '')
    .replace(/^\b(at|on|by|from)\b\s+/i, '')
    // Dangling separators left where a time used to be ("gym -", "call mom,").
    .replace(/^[\s,;:.–—-]+/, '')
    .replace(/[\s,;:–—-]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { title: title || text.trim(), date, time, endTime };
}
