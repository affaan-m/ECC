import {
  uid,
  todayISO,
  toISODate,
  addDays,
  fromISODate,
  expandEventOnDay,
  timeToMinutes,
  minutesToTime,
  formatTime,
  WEEKDAY_ABBR,
} from './helpers.js';
import { makeOverdueCheck, reconnectDaysOf } from './reconnect.js';
import { contactInsights } from './contactInsights.js';
import { optimizeRoute, formatDistance } from './routePlanner.js';
import { eventPinIdentity } from './pinLabel.js';

// The other half of the assistant: the tools run here, in the browser,
// against the same store every screen in the app writes to.
//
// Running them on the server would have meant a second implementation of
// "add an event" living next to the real one and slowly drifting from it,
// operating on a copy of the data that's only as fresh as the last sync. Here
// a created event goes through the identical reducer action the event editor
// uses, which means it's picked up by conflict detection, by the sync push,
// and by undo, for free.
//
// Every tool returns a plain string. The model reads prose perfectly well and
// it keeps the tool results legible in a network log, which matters when the
// thing you're debugging is a conversation.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_RANGE_DAYS = 31;

const ok = (content, change) => ({ content, change });
const fail = (content) => ({ content, is_error: true });

export function runAssistantTool(name, input, ctx) {
  const fn = TOOLS[name];
  if (!fn) return fail(`No such tool: ${name}.`);
  try {
    return fn(input || {}, ctx);
  } catch (err) {
    // A thrown tool is recoverable — hand the model the message and let it
    // try something else rather than killing the whole conversation.
    return fail(`That failed: ${err.message}`);
  }
}

const TOOLS = {
  list_schedule({ from, to }, { state }) {
    if (!DATE_RE.test(from || '')) return fail('`from` must be a date like 2026-07-28.');
    const end = to || from;
    if (!DATE_RE.test(end)) return fail('`to` must be a date like 2026-07-28.');
    const span = Math.round((fromISODate(end) - fromISODate(from)) / 86400000);
    if (span < 0) return fail('`to` is before `from`.');
    if (span > MAX_RANGE_DAYS) return fail(`That range is too wide — ask for ${MAX_RANGE_DAYS} days or fewer.`);

    const nameById = byId(state.contacts);
    const out = [];
    for (let d = 0; d <= span; d++) {
      const day = toISODate(addDays(fromISODate(from), d));
      const occs = (state.events || [])
        .flatMap((e) => expandEventOnDay(e, day))
        .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
      const tasks = (state.tasks || []).filter((t) => !t.done && t.dueDate === day);
      if (!occs.length && !tasks.length) continue;
      out.push(`${day} (${WEEKDAY_ABBR[fromISODate(day).getDay()]}):`);
      for (const o of occs) {
        const bits = [`${o.start || '--:--'}-${o.end || ''} ${o.title}`];
        if (o.location) bits.push(`at ${o.location}`);
        if (nameById[o.contactId]) bits.push(`with ${nameById[o.contactId].name}`);
        out.push(`  ${bits.join(' ')}`);
      }
      for (const t of tasks) out.push(`  task: ${t.title}${t.dueTime ? ` at ${t.dueTime}` : ''}`);
    }
    return ok(out.length ? out.join('\n') : `Nothing scheduled between ${from} and ${end}.`);
  },

  find_contacts({ query, overdue_only: overdueOnly }, { state }) {
    const q = (query || '').trim().toLowerCase();
    const groupById = Object.fromEntries((state.statuses || []).map((s) => [s.id, s.label]));
    const isOverdue = makeOverdueCheck(state);
    let list = state.contacts || [];
    if (q) {
      list = list.filter((c) =>
        [c.name, c.address, c.notes, groupById[c.statusId], ...(c.tags || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }
    if (overdueOnly) list = list.filter(isOverdue);
    if (list.length === 0) {
      return ok(q ? `Nobody matches "${query}".` : 'There are no contacts in the app yet.');
    }
    return ok(
      list
        .slice(0, 40)
        .map((c) => {
          const bits = [`${c.id}: ${c.name}`];
          if (groupById[c.statusId]) bits.push(groupById[c.statusId]);
          if (c.lastContacted) bits.push(`last seen ${c.lastContacted}`);
          if (isOverdue(c)) bits.push('overdue');
          return bits.join(' · ');
        })
        .join('\n')
    );
  },

  get_contact({ contact_id: contactId }, { state }) {
    const c = (state.contacts || []).find((x) => x.id === contactId);
    if (!c) return fail(`No contact with id ${contactId}. Use find_contacts to get a valid id.`);

    const groupById = Object.fromEntries((state.statuses || []).map((s) => [s.id, s.label]));
    const out = [c.name];
    if (groupById[c.statusId]) out.push(`Group: ${groupById[c.statusId]}`);
    if (c.tags?.length) out.push(`Tags: ${c.tags.join(', ')}`);
    if (c.address) out.push(`Address: ${c.address}`);
    if (c.notes) out.push(`Notes: ${c.notes}`);
    if (c.lastContacted) out.push(`Last contacted: ${c.lastContacted}`);
    out.push(`Wants contact about every ${reconnectDaysOf(c, state.settings?.reconnectDays ?? 30)} days.`);
    if (c.followUp?.date) {
      out.push(`Follow-up committed for ${c.followUp.date}${c.followUp.note ? `: ${c.followUp.note}` : ''}`);
    }

    const entries = timelineEntries(state, c.id);
    const insights = contactInsights(entries);
    if (insights.length) {
      out.push('Patterns: ' + insights.map((i) => i.text).join(' '));
    }
    const recent = entries.filter((e) => e.date <= todayISO()).slice(-6);
    if (recent.length) {
      out.push('Recently:');
      for (const e of recent) {
        out.push(`  ${e.date} — ${e.label}`);
      }
    }
    const upcoming = entries.filter((e) => e.date > todayISO()).slice(0, 4);
    if (upcoming.length) {
      out.push('Coming up:');
      for (const e of upcoming) out.push(`  ${e.date} — ${e.label}`);
    }
    return ok(out.join('\n'));
  },

  create_event(input, { state, actions }) {
    const {
      title,
      date,
      start,
      end,
      location,
      contact_id: contactId,
      notes,
      repeat,
      reminder_minutes: reminderMinutes,
    } = input;
    if (!title?.trim()) return fail('`title` is required.');
    if (!DATE_RE.test(date || '')) return fail('`date` must look like 2026-07-28.');
    if (!TIME_RE.test(start || '')) return fail('`start` must be 24-hour, like 14:30.');
    if (end && !TIME_RE.test(end)) return fail('`end` must be 24-hour, like 15:30.');
    if (end && timeToMinutes(end) <= timeToMinutes(start)) return fail('`end` must be after `start`.');
    if (contactId && !(state.contacts || []).some((c) => c.id === contactId)) {
      return fail(`No contact with id ${contactId}. Use find_contacts first, or leave it out.`);
    }

    const dur = state.settings?.defaultEventDuration || 60;
    const id = uid('e');
    const event = {
      id,
      title: title.trim(),
      date,
      start,
      end: end || minutesToTime(Math.min(timeToMinutes(start) + dur, 23 * 60 + 59)),
      location: location || '',
      contactId: contactId || '',
      notes: notes || '',
      repeat: repeat && repeat !== 'none' ? repeat : 'none',
      typeId: '',
      reminder: Number.isFinite(reminderMinutes) ? reminderMinutes : (state.settings?.defaultReminderLead || 0),
    };
    actions.addEvent(event);
    return ok(
      `Created "${event.title}" on ${date} at ${start}–${event.end}${location ? ` at ${location}` : ''}.`,
      { icon: 'calendar', label: `${event.title} · ${date} ${formatTime(start)}`, undo: () => actions.deleteEvent(id) }
    );
  },

  create_task(input, { actions }) {
    const { title, due_date: dueDate, due_time: dueTime, notes, subtasks } = input;
    if (!title?.trim()) return fail('`title` is required.');
    if (dueDate && !DATE_RE.test(dueDate)) return fail('`due_date` must look like 2026-07-28.');
    if (dueTime && !TIME_RE.test(dueTime)) return fail('`due_time` must be 24-hour, like 09:00.');
    if (dueTime && !dueDate) return fail('A `due_time` needs a `due_date` too.');

    const id = uid('t');
    actions.addTask({
      id,
      title: title.trim(),
      dueDate: dueDate || '',
      dueTime: dueTime || '',
      notes: notes || '',
      subtasks: (Array.isArray(subtasks) ? subtasks : [])
        .filter((s) => typeof s === 'string' && s.trim())
        .map((s) => ({ id: uid('sub'), text: s.trim(), done: false })),
      createdAt: todayISO(),
    });
    return ok(`Added the task "${title.trim()}"${dueDate ? `, due ${dueDate}` : ''}.`, {
      icon: 'check',
      label: `${title.trim()}${dueDate ? ` · due ${dueDate}` : ''}`,
      undo: () => actions.deleteTask(id),
    });
  },

  log_interaction(input, { state, actions }) {
    const { contact_id: contactId, date, kind, notes } = input;
    const contact = (state.contacts || []).find((c) => c.id === contactId);
    if (!contact) return fail(`No contact with id ${contactId}. Use find_contacts to get one.`);
    if (date && !DATE_RE.test(date)) return fail('`date` must look like 2026-07-28.');

    const when = date || todayISO();
    const id = uid('ix');
    const text = [kind && kind !== 'other' ? cap(kind) : '', notes || '']
      .filter(Boolean)
      .join(' — ') || 'Caught up.';
    actions.addInteraction({ id, contactId, date: when, text });
    // Logging contact is also what the reconnect reminders count from, so
    // the stamp has to move with it — otherwise the app would keep saying
    // you're overdue with someone you just told it you'd seen. Only ever
    // forward: back-filling an old visit shouldn't undo a newer one.
    const prev = contact.lastContacted || '';
    if (when > prev) actions.updateContact({ id: contactId, lastContacted: when });

    return ok(`Logged: ${contact.name}, ${when} — ${text}`, {
      icon: 'personCheck',
      label: `${contact.name} · ${when}`,
      undo: () => {
        actions.deleteInteraction(id);
        if (when > prev) actions.updateContact({ id: contactId, lastContacted: prev });
      },
    });
  },

  set_follow_up(input, { state, actions }) {
    const { contact_id: contactId, date, note } = input;
    const contact = (state.contacts || []).find((c) => c.id === contactId);
    if (!contact) return fail(`No contact with id ${contactId}.`);
    if (!DATE_RE.test(date || '')) return fail('`date` must look like 2026-07-28.');
    const prev = contact.followUp || null;
    actions.setFollowUp(contactId, { date, note: note || '' });
    return ok(`Follow-up with ${contact.name} set for ${date}.`, {
      icon: 'bell',
      label: `Follow up: ${contact.name} · ${date}`,
      undo: () => actions.setFollowUp(contactId, prev),
    });
  },

  plan_route(input, { state }) {
    const { date, depart_at: departAt, stops: wanted } = input;
    if (date && !DATE_RE.test(date)) return fail('`date` must look like 2026-07-28.');
    if (departAt && !TIME_RE.test(departAt)) return fail('`depart_at` must be 24-hour, like 09:00.');
    const day = date || todayISO();

    const contactById = byId(state.contacts);
    const typeById = byId(state.eventTypes);
    const eventStops = (state.events || [])
      .flatMap((e) => expandEventOnDay(e, day))
      .filter((o) => typeof o.locLat === 'number' && typeof o.locLng === 'number')
      .map((o) => ({
        id: `event:${o.id}:${o.recDate || day}`,
        ...eventPinIdentity(o, { contact: contactById[o.contactId], eventType: typeById[o.typeId] }),
        lat: o.locLat,
        lng: o.locLng,
        start: o.start,
        end: o.end,
      }));

    const isOverdue = makeOverdueCheck(state);
    const pinStops = (state.pins || []).map((p) => ({ ...p, label: p.label || 'Dropped pin' }));

    let stops;
    if (Array.isArray(wanted) && wanted.length) {
      const all = [...eventStops, ...pinStops];
      const missing = [];
      stops = [];
      for (const nameWanted of wanted) {
        const q = String(nameWanted).toLowerCase();
        const hit =
          all.find((s) => (s.label || '').toLowerCase() === q) ||
          all.find((s) => (s.label || '').toLowerCase().includes(q)) ||
          all.find((s) => {
            const c = contactById[s.contactId];
            return c && c.name.toLowerCase().includes(q);
          });
        if (hit && !stops.includes(hit)) stops.push(hit);
        else if (!hit) missing.push(nameWanted);
      }
      if (missing.length) {
        return fail(
          `No pin or located event matches: ${missing.join(', ')}. Only places with coordinates can be routed — ` +
            'a plain address typed into an event is not enough.'
        );
      }
    } else {
      stops = [
        ...eventStops,
        ...pinStops.filter((p) => p.contactId && isOverdue(contactById[p.contactId])),
      ];
    }

    if (stops.length < 2) {
      return ok(
        stops.length === 1
          ? `Only one stop to go to on ${day} (${stops[0].label}) — there's nothing to order.`
          : `There's nothing with a location to route on ${day}.`
      );
    }

    // Timed to leave from the first stop, since the browser's location can't
    // be read from inside a tool call without a permission prompt the user
    // has no context for.
    const start = stops[0];
    const plan = optimizeRoute(start, stops, departAt ? { departAt: timeToMinutes(departAt) } : {});
    const lines = [
      `Starting from ${start.label}, ${formatDistance(plan.totalMeters)} in total, done by ${formatTime(plan.endsAt)}${plan.endsNextDay ? ' the next day' : ''}:`,
    ];
    plan.stops.forEach((s, i) => {
      const bits = [
        `${i + 1}. ${s.label} — leave ${formatTime(s.leaveAt)}, arrive ${formatTime(s.arriveAt)}`,
        `${s.visitMinutes} min there`,
        formatDistance(s.legMeters),
      ];
      if (s.late) bits.push(`LATE by ${s.lateBy} min for its ${formatTime(s.start)} start`);
      lines.push(bits.join(', '));
    });
    lines.push('(Straight-line estimates, not turn-by-turn directions.)');
    return ok(lines.join('\n'));
  },
};

// --- helpers --------------------------------------------------------------

function byId(list) {
  return Object.fromEntries((list || []).map((x) => [x.id, x]));
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// A person's history, flattened the same way the timeline page flattens it,
// so `contactInsights` gets the shape it expects.
function timelineEntries(state, contactId) {
  const out = [];
  // Filtered before the day walk, not inside it: a repeating event has to be
  // expanded day by day to be seen at all, so this loop is 500-odd
  // iterations either way and the only thing that decides its cost is how
  // many events go through it.
  const theirs = (state.events || []).filter((e) => e.contactId === contactId);
  const from = new Date();
  for (let d = -400; d <= 120; d++) {
    const day = toISODate(addDays(from, d));
    for (const e of theirs) {
      for (const occ of expandEventOnDay(e, day)) {
        out.push({ type: 'event', date: day, occ, label: `${occ.title}${occ.start ? ` at ${occ.start}` : ''}` });
      }
    }
  }
  for (const i of state.interactions || []) {
    if (i.contactId === contactId) out.push({ type: 'interaction', date: i.date, label: i.text });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
