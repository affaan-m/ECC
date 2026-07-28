import { addDays, toISODate } from './helpers.js';

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const WEEKDAY_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function monthIndex(word) {
  const w = word.toLowerCase();
  const full = MONTHS.indexOf(w);
  if (full >= 0) return full;
  if (w === 'sept') return 8;
  return MONTH_ABBR.indexOf(w);
}

// Finds the nearest day (today or later) whose weekday matches `dow`.
// Exported — search's date-phrase parser (data/nlSearch.js) recognizes the
// same weekday words and wants exactly this "nearest upcoming" reading
// rather than a second, possibly-diverging implementation of it.
export function nextWeekday(dow, from = new Date()) {
  const delta = (dow - from.getDay() + 7) % 7;
  return toISODate(addDays(from, delta));
}

// "next friday" means the Friday of *next* week, not the nearest upcoming
// one — that's what people mean when they bother to say "next", and reading
// it as "this coming Friday" is the difference between a week's notice and
// none. Weeks start Sunday, matching the WEEKDAYS index.
function weekdayNextWeek(dow, from = new Date()) {
  const nextSunday = addDays(from, 7 - from.getDay());
  return toISODate(addDays(nextSunday, dow));
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

// Vague times of day, used only when no clock time was given. These are the
// same defaults a person would assume if you said "let's do lunch Thursday
// afternoon" and then had to write it in a diary.
const DAYPARTS = [
  [/\b(?:at\s+)?midnight\b/i, '00:00'],
  [/\b(?:in\s+the\s+)?early\s+morning\b/i, '07:00'],
  [/\b(?:in\s+the\s+)?morning\b/i, '09:00'],
  [/\b(?:at\s+)?noon|\bmidday\b/i, '12:00'],
  [/\b(?:in\s+the\s+)?afternoon\b/i, '14:00'],
  [/\b(?:in\s+the\s+)?evening\b/i, '19:00'],
  [/\b(?:at\s+)?night\b/i, '20:00'],
];

// Phrases that describe the act of scheduling rather than the thing being
// scheduled. "remind me to call mom" is a task called "call mom", not one
// called "remind me to call mom".
// "book", "add" and "create" only count as filler when an article follows:
// "book a table" is scheduling language, "book club" is the name of the
// thing. Without that guard the parser quietly renames your book club to
// "club".
const FILLER_RE =
  /^\s*(?:please\s+)?(?:can\s+you\s+)?(?:remind\s+me\s+(?:to\s+)?|reminder\s+to\s+|don'?t\s+forget\s+to\s+|i\s+need\s+to\s+|i\s+have\s+to\s+|need\s+to\s+|schedule\s+(?:an?\s+)?|set\s+up\s+(?:an?\s+)?|add\s+an?\s+|book\s+an?\s+|create\s+an?\s+)/i;

const MINUTES_PER_UNIT = { m: 1, min: 1, mins: 1, minute: 1, minutes: 1, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, d: 1440, day: 1440, days: 1440 };

// Parses free text like "coffee with Alex fri 3pm for 45 min, remind me 10
// minutes before" into a structured draft. Runs entirely offline (no API
// call) since this is a serverless PWA: a fixed set of deterministic
// patterns, each stripped out of the text so a clean title is left behind.
//
// Returns every field it managed to recognize; anything it didn't is null (or
// an empty array), and the caller fills in its own defaults. `contacts` is
// optional — without it, people simply aren't linked.
//
// Order matters here and is not arbitrary. Reminders are pulled out before
// times so "30 minutes before" isn't mistaken for the appointment itself;
// locations are pulled out after times so "at 3pm" isn't mistaken for a
// place called 3pm.
export function parseQuickAdd(text, { contacts = [], now = new Date() } = {}) {
  let remaining = text.trim();
  let date = null;
  let time = null;
  let endTime = null;
  let durationMinutes = null;
  let reminderMinutes = null;
  let repeat = 'none';
  let repeatDays = [];
  let location = '';
  let contactId = '';
  let contactName = '';
  // Whether the date came from a bare weekday name, which is the one case
  // where a time already past means "next week" rather than "this morning".
  let dateFromWeekday = false;

  const strip = (re, replacement = ' ') => {
    const m = remaining.match(re);
    if (m) remaining = remaining.replace(m[0], replacement);
    return m;
  };

  // --- 1. Recurrence -------------------------------------------------------
  const dayNamesGroup = `${WEEKDAYS.join('|')}|${WEEKDAY_ABBR.join('|')}`;
  const everyDays = remaining.match(
    new RegExp(`\\b(?:every|each)\\s+((?:${dayNamesGroup})(?:\\s*(?:,|and|&|\\+)\\s*(?:${dayNamesGroup}))*)\\b`, 'i')
  );
  if (everyDays) {
    const names = everyDays[1].split(/\s*(?:,|and|&|\+)\s*/i).filter(Boolean);
    const dows = [...new Set(names.map((n) => dowFromName(n)).filter((d) => d >= 0))].sort();
    if (dows.length === 1) {
      repeat = 'weekly';
      date = nextWeekday(dows[0], now);
    } else if (dows.length > 1) {
      repeat = 'custom';
      repeatDays = dows;
      date = earliestUpcoming(dows, now);
    }
    remaining = remaining.replace(everyDays[0], ' ');
  } else if (strip(/\b(?:every\s+(?:other\s+week|2\s+weeks|two\s+weeks)|biweekly|fortnightly)\b/i)) {
    repeat = 'biweekly';
  } else if (strip(/\b(?:every\s+weekday|(?:on\s+)?weekdays)\b/i)) {
    repeat = 'custom';
    repeatDays = [1, 2, 3, 4, 5];
    date = earliestUpcoming(repeatDays, now);
  } else if (strip(/\b(?:every\s+weekend|(?:on\s+)?weekends)\b/i)) {
    repeat = 'custom';
    repeatDays = [0, 6];
    date = earliestUpcoming(repeatDays, now);
  } else if (strip(/\b(?:every\s+day|daily)\b/i)) {
    repeat = 'daily';
  } else if (strip(/\b(?:every\s+week|weekly)\b/i)) {
    repeat = 'weekly';
  } else if (strip(/\b(?:every\s+month|monthly)\b/i)) {
    repeat = 'monthly';
  } else if (strip(/\b(?:every\s+year|yearly|annually)\b/i)) {
    // No yearly rule in the data model; monthly-on-the-date is wrong, so the
    // honest answer is a one-off rather than a quietly incorrect repeat.
    repeat = 'none';
  }

  // --- 2. Reminder lead ----------------------------------------------------
  const remind = remaining.match(
    /\b(?:remind(?:er)?(?:\s+me)?\s+)?(?:(\d+)|an?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\s*(?:before|ahead|prior|early|in\s+advance)\b/i
  );
  if (remind) {
    const n = remind[1] ? Number(remind[1]) : 1;
    reminderMinutes = n * (MINUTES_PER_UNIT[remind[2].toLowerCase()] || 1);
    remaining = remaining.replace(remind[0], ' ');
    // "remind me" left dangling once its "N minutes before" was taken.
    remaining = remaining.replace(/\bremind(?:er)?(?:\s+me)?\b\s*$/i, ' ');
  }

  // --- 3. Duration ---------------------------------------------------------
  const dur = remaining.match(
    /\bfor\s+(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i
  );
  if (dur) {
    durationMinutes = Math.round(Number(dur[1]) * (MINUTES_PER_UNIT[dur[2].toLowerCase()] || 1));
    remaining = remaining.replace(dur[0], ' ');
  } else {
    const halfHour = remaining.match(/\bfor\s+(?:an?\s+)?(?:half\s+an\s+hour|30\s*(?:m|min|mins|minutes))\b/i);
    if (halfHour) {
      durationMinutes = 30;
      remaining = remaining.replace(halfHour[0], ' ');
    } else if (strip(/\bfor\s+an\s+hour\b/i)) {
      durationMinutes = 60;
    }
  }

  // --- 4. Explicit calendar dates -----------------------------------------
  if (!date) {
    const monthGroup = [...MONTHS, ...MONTH_ABBR].join('|');
    const monthDay = remaining.match(
      new RegExp(`\\b(?:on\\s+)?(${monthGroup})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`, 'i')
    );
    const dayMonth = remaining.match(
      new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthGroup})\\.?(?:,?\\s*(\\d{4}))?\\b`, 'i')
    );
    const numeric = remaining.match(/\b(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    const ordinal = remaining.match(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i);
    if (monthDay) {
      date = calendarDate(monthIndex(monthDay[1]), Number(monthDay[2]), monthDay[3], now);
      remaining = remaining.replace(monthDay[0], ' ');
    } else if (dayMonth) {
      date = calendarDate(monthIndex(dayMonth[2]), Number(dayMonth[1]), dayMonth[3], now);
      remaining = remaining.replace(dayMonth[0], ' ');
    } else if (numeric) {
      date = calendarDate(Number(numeric[1]) - 1, Number(numeric[2]), numeric[3], now);
      remaining = remaining.replace(numeric[0], ' ');
    } else if (ordinal) {
      date = dayOfMonth(Number(ordinal[1]), now);
      remaining = remaining.replace(ordinal[0], ' ');
    }
  }

  // --- 5. Relative day words ----------------------------------------------
  if (!date) {
    if (strip(/\btonight\b/i)) {
      date = toISODate(now);
      time = '19:00';
    } else if (strip(/\bday\s+after\s+tomorrow\b/i)) {
      date = toISODate(addDays(now, 2));
    } else if (strip(/\btomorrow\b/i)) {
      date = toISODate(addDays(now, 1));
    } else if (strip(/\btoday\b/i)) {
      date = toISODate(now);
    } else if (strip(/\bthis\s+weekend\b/i)) {
      date = nextWeekday(6, now); // upcoming Saturday
    } else if (strip(/\bnext\s+week\b/i)) {
      date = toISODate(addDays(now, 7));
    } else if (strip(/\bnext\s+month\b/i)) {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
      date = toISODate(d);
    } else {
      const rel = remaining.match(/\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b/i);
      if (rel) {
        const n = Number(rel[1]);
        if (/month/i.test(rel[2])) {
          date = toISODate(new Date(now.getFullYear(), now.getMonth() + n, now.getDate()));
        } else {
          date = toISODate(addDays(now, /week/i.test(rel[2]) ? n * 7 : n));
        }
        remaining = remaining.replace(rel[0], ' ');
      } else {
        const wd = remaining.match(new RegExp(`\\b(next\\s+|this\\s+)?(${dayNamesGroup})\\b`, 'i'));
        if (wd) {
          const dow = dowFromName(wd[2]);
          const isNext = /next/i.test(wd[1] || '');
          date = isNext ? weekdayNextWeek(dow, now) : nextWeekday(dow, now);
          dateFromWeekday = !isNext;
          remaining = remaining.replace(wd[0], ' ');
        }
      }
    }
  }

  // --- 6. Times ------------------------------------------------------------
  // A range first — "3-5pm", "9:30 to 11", "from 2pm until 4pm". Matching the
  // whole thing in one go is what keeps the title clean: the connector and
  // both meridiems come out with it, instead of "to 5pm" being left behind
  // as part of the title.
  const range = remaining.match(RANGE_RE);
  if (range) {
    const [, h1, m1, mer1, h2, m2, mer2] = range;
    // An unmarked endpoint borrows the other's am/pm — "3-5pm" means both are
    // afternoon, and "9am-12" runs to midday.
    const start = resolveHour(Number(h1), mer1, mer2);
    const end = resolveHour(Number(h2), mer2, mer1);
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
      time = `${pad2(h)}:${pad2(ampm[2] ? Number(ampm[2]) : 0)}`;
      remaining = remaining.replace(ampm[0], ' ');
    } else {
      const clock = remaining.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
      if (clock) {
        time = `${pad2(Number(clock[1]))}:${clock[2]}`;
        remaining = remaining.replace(clock[0], ' ');
      }
    }
  }

  if (!time) {
    for (const [re, at] of DAYPARTS) {
      if (strip(re)) {
        time = at;
        break;
      }
    }
  }

  // A weekday name that lands on today, at a time that's already gone, means
  // the one coming up — nobody types "monday 9am" on Monday afternoon hoping
  // to schedule something in the past.
  if (dateFromWeekday && time && date === toISODate(now)) {
    const [h, m] = time.split(':').map(Number);
    if (h * 60 + m < now.getHours() * 60 + now.getMinutes()) date = toISODate(addDays(now, 7));
  }

  if (durationMinutes && time && !endTime) {
    const [h, m] = time.split(':').map(Number);
    const endMins = Math.min(23 * 60 + 59, h * 60 + m + durationMinutes);
    endTime = `${pad2(Math.floor(endMins / 60))}:${pad2(endMins % 60)}`;
  }

  // --- 7. Location ---------------------------------------------------------
  // Only now that times are gone, so "at 3pm" can't be read as a place. "@X"
  // is unambiguous; "at X" is only trusted at the end of the string, which is
  // where a venue almost always sits ("lunch with Sam at Blue Bottle").
  const atSign = remaining.match(/\s@\s*([^,;]+?)\s*$/);
  if (atSign) {
    location = atSign[1].trim();
    remaining = remaining.replace(atSign[0], ' ');
  } else {
    const atWord = remaining.match(/\bat\s+((?:\w[\w'&.-]*)(?:\s+\w[\w'&.-]*){0,3})\s*$/i);
    if (atWord && !/^\d/.test(atWord[1])) {
      location = atWord[1].trim();
      remaining = remaining.replace(atWord[0], ' ');
    }
  }

  // --- 8. People -----------------------------------------------------------
  // "with <name>" takes the name out of the title, since the person is shown
  // beside it anyway. A name mentioned any other way ("call mom") is linked
  // but left in place — removing it would leave a title of just "call".
  const match = findContact(remaining, contacts);
  if (match) {
    contactId = match.contact.id;
    contactName = match.contact.name;
    const withPhrase = new RegExp(`\\b(?:with|w/)\\s+${escapeRe(match.matched)}\\b`, 'i');
    if (withPhrase.test(remaining)) remaining = remaining.replace(withPhrase, ' ');
  }

  // --- 9. Title ------------------------------------------------------------
  let title = remaining.replace(FILLER_RE, '');
  // A meridiem only ever survives here if it got separated from its number by
  // something the patterns above didn't cover, so it's safe to drop — but
  // only when a time was actually found, so a title that just happens to
  // contain "am" is left alone.
  if (time) title = title.replace(/\b(am|pm|a\.m\.|p\.m\.)\b/gi, ' ');
  title = title
    .replace(/\s{2,}/g, ' ')
    .trim()
    // Connectors orphaned by removing what followed them ("lunch with Sam at").
    .replace(/\s+\b(at|on|by|from|to|until|till|til|with|w\/|for|every|each)\b\s*$/i, '')
    .replace(/^\b(at|on|by|from|with|for)\b\s+/i, '')
    // Dangling separators left where a time used to be ("gym -", "call mom,").
    .replace(/^[\s,;:.–—-]+/, '')
    .replace(/[\s,;:–—-]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!title && contactName) title = contactName;

  // A clock time, a span, or a length all describe something that occupies a
  // slot in the day — that's an event. Everything else is a task, which is
  // allowed to have a due date but doesn't have to sit anywhere.
  const kind = time || endTime || durationMinutes ? 'event' : 'task';

  return {
    title: title || text.trim(),
    date,
    time,
    endTime,
    durationMinutes,
    reminderMinutes,
    repeat,
    repeatDays,
    location,
    contactId,
    contactName,
    kind,
  };
}

function dowFromName(name) {
  const n = name.toLowerCase();
  const full = WEEKDAYS.indexOf(n);
  return full >= 0 ? full : WEEKDAY_ABBR.indexOf(n);
}

// The soonest of several weekdays — where "every mon/wed/fri" should start.
function earliestUpcoming(dows, now) {
  return dows.map((d) => nextWeekday(d, now)).sort()[0];
}

// A month/day with no year given belongs to whichever year keeps it in the
// future: typing "jan 4" in December means next January, not one that's
// already been and gone.
function calendarDate(monthIdx, day, yearText, now) {
  if (monthIdx < 0 || day < 1 || day > 31) return null;
  if (yearText) {
    const y = Number(yearText);
    return toISODate(new Date(y < 100 ? 2000 + y : y, monthIdx, day));
  }
  const thisYear = new Date(now.getFullYear(), monthIdx, day);
  const iso = toISODate(thisYear);
  if (iso >= toISODate(now)) return iso;
  return toISODate(new Date(now.getFullYear() + 1, monthIdx, day));
}

// "the 12th" — this month if it hasn't passed, otherwise next month.
function dayOfMonth(day, now) {
  if (day < 1 || day > 31) return null;
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), day);
  if (toISODate(thisMonth) >= toISODate(now)) return toISODate(thisMonth);
  return toISODate(new Date(now.getFullYear(), now.getMonth() + 1, day));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Longest name wins, so "Alex Rivera" beats a different contact called
// "Alex". First names are matched too, but only when they're unambiguous —
// linking "lunch with Sam" to one of two Sams would be a coin flip presented
// as a fact.
function findContact(text, contacts) {
  if (!contacts?.length) return null;
  const candidates = [];
  const firstNameCount = {};
  for (const c of contacts) {
    const first = (c.name || '').trim().split(/\s+/)[0];
    if (first) firstNameCount[first.toLowerCase()] = (firstNameCount[first.toLowerCase()] || 0) + 1;
  }
  for (const c of contacts) {
    const name = (c.name || '').trim();
    if (!name) continue;
    candidates.push({ contact: c, matched: name });
    const first = name.split(/\s+/)[0];
    if (first !== name && firstNameCount[first.toLowerCase()] === 1) {
      candidates.push({ contact: c, matched: first });
    }
  }
  candidates.sort((a, b) => b.matched.length - a.matched.length);
  for (const cand of candidates) {
    if (new RegExp(`\\b${escapeRe(cand.matched)}\\b`, 'i').test(text)) return cand;
  }
  return null;
}
