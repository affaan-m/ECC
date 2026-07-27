import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../data/store.jsx';
import { Brand } from '../components/Logo.jsx';
import {
  todayISO,
  toISODate,
  addDays,
  occursOn,
  eventOccursInRange,
  formatShortDate,
  formatTime,
} from '../data/helpers.js';
import { parseSearchQuery } from '../data/nlSearch.js';
import { contactDatesInRange, contactDatesWithin, contactDateLabel } from '../data/contactDates.js';

// How far ahead a bare "birthdays" query (no date phrase of its own) looks —
// far enough to be useful, not so far it lists literally everyone tracked.
const BARE_BIRTHDAY_WINDOW_DAYS = 120;

const MAX_PER_GROUP = 8;

// For a (possibly recurring) event, find the closest date worth jumping to:
// the nearest occurrence today or in the future, or — if it only ever
// occurred in the past (a finished recurrence, or a one-off that's over) —
// the nearest one behind today. Cheap boolean check per day, only run when a
// result is actually tapped, not on every keystroke.
function nearestEventDate(ev) {
  const today = todayISO();
  for (let i = 0; i <= 366; i++) {
    const iso = toISODate(addDays(today, i));
    if (occursOn(ev, iso)) return iso;
  }
  for (let i = 1; i <= 366; i++) {
    const iso = toISODate(addDays(today, -i));
    if (occursOn(ev, iso)) return iso;
  }
  return ev.date;
}

export default function SearchPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const contactName = (id) => state.contacts.find((c) => c.id === id)?.name || '';

  // Recognizes date ranges ("next week"), a person ("with Sarah"), and a
  // "birthdays"/"anniversary" mention, and hands back whatever's left as
  // plain keywords. When none of that is present, `keywords` is just the
  // original text and every group below matches exactly as it always has —
  // this only adds filters on top, it never takes the plain case away.
  const parsed = useMemo(
    () => parseSearchQuery(query, state.contacts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, state.contacts]
  );
  const kw = parsed.keywords.toLowerCase();

  const results = useMemo(() => {
    if (!q) return null;
    const has = (s) => !!kw && (s || '').toLowerCase().includes(kw);
    const inRange = (iso) => !parsed.fromISO || (iso >= parsed.fromISO && iso <= parsed.toISO);
    // "birthdays this month" on its own names a date range, but the date
    // range is only there to scope the birthdays — it isn't also asking for
    // every unrelated event that month. Without this, that query would dump
    // the whole month's calendar in alongside the one group it actually
    // asked for. Real keyword text or a named person still overrides it —
    // "sarah's birthday plans this month" has more going on than just dates.
    const pureDateQuery = parsed.wantsBirthdays && !kw && !parsed.personId;

    const events = state.events.filter((e) => {
      if (pureDateQuery) return false;
      if (parsed.personId && e.contactId !== parsed.personId) return false;
      if (parsed.fromISO && !eventOccursInRange(e, parsed.fromISO, parsed.toISO)) return false;
      if (!kw) return !!(parsed.personId || parsed.fromISO);
      return has(e.title) || has(e.notes) || has(e.location) || has(contactName(e.contactId));
    });
    const tasks = state.tasks.filter((t) => {
      if (pureDateQuery) return false;
      if (parsed.personId && t.followUpContactId !== parsed.personId) return false;
      if (parsed.fromISO && !(t.dueDate && inRange(t.dueDate))) return false;
      if (!kw) return !!(parsed.personId || parsed.fromISO);
      return has(t.title) || has(t.location) || (t.subtasks || []).some((s) => has(s.text));
    });
    // Goals, people, and notes carry no date of their own, so a pure
    // date/person query (empty keywords) has nothing to match them against
    // — they only show up once there's real text to search for.
    const goals = kw ? state.goals.filter((g) => has(g.title) || has(g.category)) : [];
    const contacts = kw
      ? state.contacts.filter(
          (c) => has(c.name) || has(c.phone) || has(c.email) || has(c.notes) || (c.tags || []).some(has)
        )
      : [];
    const notes = kw
      ? state.notes.filter((n) => has(n.title) || has(n.body) || (n.checklist || []).some((i) => has(i.text)))
      : [];
    const birthdays =
      parsed.wantsBirthdays && state.settings?.contactBirthdaysEnabled !== false
        ? parsed.fromISO
          ? // A named range ("this month") — bounded by construction to at
            // most a month, which is exactly what contactDatesInRange scans.
            contactDatesInRange(state.contacts, parsed.fromISO, parsed.toISO)
          : // No range named — "birthdays" on its own. Unbounded lookup,
            // capped to a sensible window rather than listing every date
            // tracked for the rest of forever.
            contactDatesWithin(state.contacts, BARE_BIRTHDAY_WINDOW_DAYS)
        : [];
    return { events, tasks, goals, contacts, notes, birthdays };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, kw, parsed, state.events, state.tasks, state.goals, state.contacts, state.notes, state.settings]);

  const total = results
    ? results.events.length +
      results.tasks.length +
      results.goals.length +
      results.contacts.length +
      results.notes.length +
      results.birthdays.length
    : 0;

  const openEvent = (ev) =>
    navigate('/planner', { state: { openEventId: ev.id, openEventDate: nearestEventDate(ev) } });
  const openTask = (t) => navigate('/', { state: { openTaskId: t.id } });
  const openNote = (n) => navigate('/', { state: { openNoteId: n.id } });
  const openGoal = () => navigate('/goals');
  const openContact = (c) => navigate(`/contacts/${c.id}`);
  const openBirthday = (d) => navigate(`/contacts/${d.contactId}`);

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-row">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
            <BackIcon />
          </button>
          <Brand>Search</Brand>
        </div>
      </header>

      <input
        className="search"
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search events, tasks, goals, people, notes"
      />

      {!q ? (
        <p className="muted center-pad">
          Search across everything — events, tasks, goals, people, and notes. Try "meetings with
          Sam next week" or "birthdays this month".
        </p>
      ) : total === 0 ? (
        <p className="muted center-pad">No matches for "{query.trim()}".</p>
      ) : (
        <>
          <ResultGroup label="Birthdays & anniversaries" icon="🎂" items={results.birthdays} onOpen={openBirthday}>
            {(d) => {
              const { text, detail } = contactDateLabel(d);
              return (
                <>
                  <span className="search-result-title">{text}</span>
                  <span className="search-result-sub muted small">
                    {formatShortDate(d.nextDate)} · {detail}
                  </span>
                </>
              );
            }}
          </ResultGroup>
          <ResultGroup label="Events" icon="📅" items={results.events} onOpen={openEvent}>
            {(ev) => (
              <>
                <span className="search-result-title">{ev.title || 'Untitled'}</span>
                <span className="search-result-sub muted small">
                  {[formatShortDate(nearestEventDate(ev)), ev.start && formatTime(ev.start), ev.location]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </>
            )}
          </ResultGroup>
          <ResultGroup label="Tasks" icon="✓" items={results.tasks} onOpen={openTask}>
            {(t) => (
              <>
                <span className="search-result-title">{t.title}</span>
                {(t.dueDate || t.location) && (
                  <span className="search-result-sub muted small">
                    {[t.dueDate && formatShortDate(t.dueDate), t.location].filter(Boolean).join(' · ')}
                  </span>
                )}
              </>
            )}
          </ResultGroup>
          <ResultGroup label="Goals" icon="🎯" items={results.goals} onOpen={openGoal}>
            {(g) => (
              <>
                <span className="search-result-title">{g.title}</span>
                <span className="search-result-sub muted small">{g.category}</span>
              </>
            )}
          </ResultGroup>
          <ResultGroup label="People" icon="👤" items={results.contacts} onOpen={openContact}>
            {(c) => (
              <>
                <span className="search-result-title">{c.name}</span>
                {(c.phone || c.email) && (
                  <span className="search-result-sub muted small">{c.phone || c.email}</span>
                )}
              </>
            )}
          </ResultGroup>
          <ResultGroup label="Notes" icon="📝" items={results.notes} onOpen={openNote}>
            {(n) => (
              <>
                <span className="search-result-title">{n.title || 'Untitled note'}</span>
                {n.body && <span className="search-result-sub muted small">{n.body}</span>}
              </>
            )}
          </ResultGroup>
        </>
      )}
    </div>
  );
}

function ResultGroup({ label, icon, items, onOpen, children }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, MAX_PER_GROUP);
  return (
    <section className="detail-section">
      <span className="detail-label">
        {label} · {items.length}
      </span>
      <div className="search-result-list">
        {shown.map((item) => (
          <button key={item.id} className="search-result-row" onClick={() => onOpen(item)}>
            <span className="search-result-icon" aria-hidden="true">
              {icon}
            </span>
            <span className="search-result-body">{children(item)}</span>
            <ChevronIcon />
          </button>
        ))}
      </div>
      {items.length > MAX_PER_GROUP && (
        <p className="muted small search-result-more">+{items.length - MAX_PER_GROUP} more — keep typing to narrow it down</p>
      )}
    </section>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
