import { addDays, expandEventOnDay, startOfWeek, toISODate, uid, weekDays } from './helpers.js';

// A template is a day's (or week's) shape, saved so it can be stamped down
// again. It stores plain time blocks rather than references to the events it
// was captured from, so editing or deleting the original day never mutates
// the template, and applying one never entangles two days.

// Fields worth carrying from an event into a block. Notably absent: `date`
// (the whole point is that it moves), `repeat` (a template is applied to
// specific days; a repeating event stamped repeatedly would multiply), and
// anything occurrence-specific like overrides or done-state.
const BLOCK_FIELDS = ['title', 'start', 'end', 'location', 'locLat', 'locLng', 'notes', 'kind', 'color', 'contactId', 'reminder'];

function toBlock(occ, dayOffset) {
  const block = { dayOffset };
  for (const f of BLOCK_FIELDS) {
    if (occ[f] !== undefined && occ[f] !== null && occ[f] !== '') block[f] = occ[f];
  }
  return block;
}

// Captures what is actually *on screen* for the given day(s) — occurrences,
// not raw events — so a weekly recurring meeting is saved as the concrete
// block the user sees, which is what they mean by "this day's shape".
export function captureDay(events, iso) {
  return events
    .flatMap((e) => expandEventOnDay(e, iso))
    .filter((o) => o.start && o.end)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((o) => toBlock(o, 0));
}

export function captureWeek(events, weekStartDate) {
  const days = weekDays(weekStartDate);
  return days.flatMap((d, i) =>
    events
      .flatMap((e) => expandEventOnDay(e, toISODate(d)))
      .filter((o) => o.start && o.end)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((o) => toBlock(o, i))
  );
}

export function makeTemplate({ name, kind, blocks }) {
  return {
    id: uid('tpl'),
    name: name.trim() || (kind === 'week' ? 'Untitled week' : 'Untitled day'),
    kind,
    blocks,
    createdAt: new Date().toISOString(),
  };
}

// Turns a template into concrete events for a target date. A week template
// lands on the week *containing* the target date, aligned to the user's
// chosen week start, so applying it from any day of that week does the same
// thing rather than silently shifting by the weekday you happened to be on.
export function instantiate(template, targetISO) {
  const base =
    template.kind === 'week'
      ? startOfWeek(new Date(`${targetISO}T00:00:00`))
      : new Date(`${targetISO}T00:00:00`);
  return template.blocks.map((b) => {
    const { dayOffset = 0, ...rest } = b;
    return {
      id: uid('e'),
      title: '',
      start: '09:00',
      end: '10:00',
      contactId: '',
      location: '',
      locLat: null,
      locLng: null,
      notes: '',
      kind: '',
      color: '',
      reminder: 0,
      repeat: 'none',
      repeatUntil: '',
      repeatDays: [],
      done: false,
      doneDates: [],
      skipDates: [],
      ...rest,
      date: toISODate(addDays(base, dayOffset)),
    };
  });
}

export function templateSummary(t) {
  const n = t.blocks.length;
  const unit = n === 1 ? 'block' : 'blocks';
  return t.kind === 'week' ? `${n} ${unit} across the week` : `${n} ${unit}`;
}
