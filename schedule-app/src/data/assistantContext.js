import {
  todayISO,
  toISODate,
  addDays,
  fromISODate,
  expandEventOnDay,
  formatTime,
  WEEKDAY_ABBR,
} from './helpers.js';
import { makeOverdueCheck, reconnectDaysOf } from './reconnect.js';

// What the assistant is told before it's asked anything.
//
// The alternative was to make it call a tool for every single fact, which
// costs a round trip each time and makes the bubble feel slow for the
// question people actually ask ("what have I got on tomorrow?"). So the
// common ground — today, the coming week, who's in the address book — is
// handed over up front, and the tools exist for everything beyond it.
//
// Deliberately plain text rather than JSON. It reads as about a third of the
// tokens for the same content, and there's nothing here that needs a
// machine-parseable shape.
//
// This is the user's own data going to a model, so it's worth being precise
// about what: names, groups and the titles/times/places of appointments. Not
// note bodies, not phone numbers, not email addresses, not photos. Anything
// the assistant needs beyond the summary it has to ask for by tool call —
// which keeps the default payload small and means the detailed stuff only
// leaves the device when it's actually relevant to the question.

const HORIZON_DAYS = 14;
const MAX_CONTACTS = 120;
const MAX_LINES = 220;

export function buildAssistantContext(state, { now = new Date() } = {}) {
  const lines = [];
  const iso = todayISO();

  lines.push(
    `Today is ${WEEKDAY_ABBR[now.getDay()]} ${iso}, and the time is ${pad(now.getHours())}:${pad(now.getMinutes())}.`
  );
  const dur = state.settings?.defaultEventDuration || 60;
  lines.push(`The user's default event length is ${dur} minutes.`);

  // --- People --------------------------------------------------------------
  const groupById = Object.fromEntries((state.statuses || []).map((s) => [s.id, s.label]));
  const overdue = makeOverdueCheck(state);
  const contacts = state.contacts || [];
  lines.push('');
  lines.push(`## People (${contacts.length})`);
  if (contacts.length === 0) {
    lines.push('(none yet)');
  } else {
    for (const c of contacts.slice(0, MAX_CONTACTS)) {
      const bits = [`${c.id}: ${c.name}`];
      const group = groupById[c.statusId];
      if (group) bits.push(group);
      if (c.tags?.length) bits.push(c.tags.join('/'));
      if (c.lastContacted) bits.push(`last seen ${c.lastContacted}`);
      if (overdue(c)) bits.push(`OVERDUE (every ${reconnectDaysOf(c, state.settings?.reconnectDays ?? 30)}d)`);
      if (c.followUp?.date) bits.push(`follow up by ${c.followUp.date}`);
      if (c.address) bits.push('has an address on file');
      lines.push(`- ${bits.join(' · ')}`);
    }
    if (contacts.length > MAX_CONTACTS) {
      lines.push(`- …and ${contacts.length - MAX_CONTACTS} more — use find_contacts to search them.`);
    }
  }

  // --- The next fortnight --------------------------------------------------
  lines.push('');
  lines.push(`## Calendar, ${iso} to ${toISODate(addDays(fromISODate(iso), HORIZON_DAYS))}`);
  const nameById = Object.fromEntries(contacts.map((c) => [c.id, c.name]));
  let any = false;
  for (let d = 0; d <= HORIZON_DAYS; d++) {
    const day = toISODate(addDays(fromISODate(iso), d));
    const occs = (state.events || [])
      .flatMap((e) => expandEventOnDay(e, day))
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    if (occs.length === 0) continue;
    any = true;
    lines.push(`${day} (${WEEKDAY_ABBR[fromISODate(day).getDay()]}):`);
    for (const o of occs) {
      const bits = [`${formatRange(o.start, o.end)} ${o.title}`];
      if (o.location) bits.push(`at ${o.location}`);
      if (o.contactId && nameById[o.contactId]) bits.push(`with ${nameById[o.contactId]}`);
      lines.push(`  - ${bits.join(' ')}`);
    }
  }
  if (!any) lines.push('(nothing scheduled)');

  // --- Open tasks ----------------------------------------------------------
  const open = (state.tasks || []).filter((t) => !t.done);
  lines.push('');
  lines.push(`## Open tasks (${open.length})`);
  if (open.length === 0) {
    lines.push('(none)');
  } else {
    const sorted = open
      .slice()
      .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
    for (const t of sorted.slice(0, 40)) {
      const when = t.dueDate ? `due ${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ''}` : 'no due date';
      lines.push(`- ${t.title} (${when})`);
    }
  }

  // --- Places --------------------------------------------------------------
  const pins = state.pins || [];
  if (pins.length) {
    lines.push('');
    lines.push(`## Saved places (${pins.length})`);
    for (const p of pins.slice(0, 40)) {
      lines.push(`- ${p.label || 'Dropped pin'}${p.address ? ` — ${p.address}` : ''}`);
    }
  }

  const out = lines.slice(0, MAX_LINES).join('\n');
  return out;
}

function formatRange(start, end) {
  if (!start) return 'all day';
  return end ? `${formatTime(start)}–${formatTime(end)}` : formatTime(start);
}

function pad(n) {
  return String(n).padStart(2, '0');
}
