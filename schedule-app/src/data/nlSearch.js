import { todayISO, toISODate, addDays, startOfMonth, addMonths, endOfMonthISO } from './helpers.js';
import { WEEKDAYS, WEEKDAY_ABBR, nextWeekday } from './smartParse.js';

// Turns a phrase like "meetings with Sarah next month" into a structured
// filter — a date range, a specific person, and whatever text is left over
// — instead of leaving search to match that whole sentence literally against
// a title and finding nothing. Deliberately layered on top of the existing
// substring search rather than replacing it: strip out only what's
// recognized, and if nothing is, `keywords` is just the original query and
// every result behaves exactly as it did before this existed. Same offline,
// pattern-matching approach as smartParse.js, and for the same reason —
// this is a serverless PWA with no NLP API to call.

function stripMatch(text, re) {
  const m = text.match(re);
  if (!m) return { text, matched: false };
  return { text: text.replace(re, ' '), matched: true, match: m };
}

// Recognizes a phrase naming a *range* of days (as opposed to smartParse's
// single-date phrases, which is all a new event needs) and returns
// { fromISO, toISO, text } with the phrase removed, or null if none matched.
function stripDateRange(text) {
  const today = todayISO();

  let r = stripMatch(text, /\btoday\b/i);
  if (r.matched) return { fromISO: today, toISO: today, text: r.text };

  r = stripMatch(text, /\btomorrow\b/i);
  if (r.matched) {
    const iso = toISODate(addDays(today, 1));
    return { fromISO: iso, toISO: iso, text: r.text };
  }

  // "this week" before "next week" doesn't matter here since the phrases
  // don't overlap, but next-month/this-month do need next checked first —
  // "this month" is not a substring of "next month" either way, so order is
  // only a readability choice below, not a correctness one.
  r = stripMatch(text, /\bnext week\b/i);
  if (r.matched) {
    return { fromISO: toISODate(addDays(today, 7)), toISO: toISODate(addDays(today, 13)), text: r.text };
  }
  r = stripMatch(text, /\bthis week\b/i);
  if (r.matched) {
    return { fromISO: today, toISO: toISODate(addDays(today, 6)), text: r.text };
  }

  r = stripMatch(text, /\bnext month\b/i);
  if (r.matched) {
    const start = startOfMonth(addMonths(today, 1));
    return { fromISO: toISODate(start), toISO: endOfMonthISO(start), text: r.text };
  }
  r = stripMatch(text, /\bthis month\b/i);
  if (r.matched) {
    return { fromISO: toISODate(startOfMonth(today)), toISO: endOfMonthISO(today), text: r.text };
  }

  r = stripMatch(text, /\bin\s+(\d+)\s+(day|days|week|weeks)\b/i);
  if (r.matched) {
    const n = Number(r.match[1]);
    const days = /week/i.test(r.match[2]) ? n * 7 : n;
    const iso = toISODate(addDays(today, days));
    return { fromISO: iso, toISO: iso, text: r.text };
  }

  const wdRe = new RegExp(`\\b(?:next\\s+)?(${WEEKDAYS.join('|')}|${WEEKDAY_ABBR.join('|')})\\b`, 'i');
  r = stripMatch(text, wdRe);
  if (r.matched) {
    const name = r.match[1].toLowerCase();
    const dow = WEEKDAYS.indexOf(name) >= 0 ? WEEKDAYS.indexOf(name) : WEEKDAY_ABBR.indexOf(name);
    const iso = nextWeekday(dow);
    return { fromISO: iso, toISO: iso, text: r.text };
  }

  return null;
}

// "with Sarah" / "with Sarah Connor" — up to three words, since a name is
// rarely longer than that and a longer capture risks swallowing whatever
// comes after it in the sentence.
const WITH_RE = /\bwith\s+([a-z][\w'-]*(?:\s+[a-z][\w'-]*){0,2})/i;

function findContactByFragment(contacts, fragment) {
  const f = fragment.trim().toLowerCase();
  if (!f) return null;
  const firstWord = (s) => (s || '').trim().toLowerCase().split(/\s+/)[0];
  return (
    contacts.find((c) => (c.name || '').trim().toLowerCase() === f) ||
    contacts.find((c) => firstWord(c.name) === firstWord(f)) ||
    contacts.find((c) => (c.name || '').toLowerCase().includes(f) || f.includes((c.name || '').toLowerCase())) ||
    null
  );
}

const BIRTHDAY_WORD_RE = /\b(birthdays?|anniversar(?:y|ies))\b/i;

export function parseSearchQuery(rawQuery, contacts) {
  let text = (rawQuery || '').trim();
  let fromISO = null;
  let toISO = null;
  let personId = null;
  let personName = null;
  let wantsBirthdays = false;

  const range = stripDateRange(text);
  if (range) {
    fromISO = range.fromISO;
    toISO = range.toISO;
    text = range.text;
  }

  const withMatch = text.match(WITH_RE);
  if (withMatch) {
    const contact = findContactByFragment(contacts || [], withMatch[1]);
    if (contact) {
      personId = contact.id;
      personName = contact.name;
      text = text.replace(withMatch[0], ' ');
    }
  }

  if (BIRTHDAY_WORD_RE.test(text)) {
    wantsBirthdays = true;
    text = text.replace(BIRTHDAY_WORD_RE, ' ');
  }

  const keywords = text
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^\b(for|on|in|at)\b\s+/i, '')
    .replace(/\s+\b(for|on|in|at)\b\s*$/i, '')
    .trim();

  return { keywords, fromISO, toISO, personId, personName, wantsBirthdays };
}
