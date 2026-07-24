import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../data/store.jsx';
import { Brand } from '../components/Logo.jsx';
import { todayISO, toISODate, addDays, occursOn, formatShortDate, formatTime } from '../data/helpers.js';

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

  const results = useMemo(() => {
    if (!q) return null;
    const has = (s) => (s || '').toLowerCase().includes(q);

    const events = state.events.filter(
      (e) => has(e.title) || has(e.notes) || has(e.location) || has(contactName(e.contactId))
    );
    const tasks = state.tasks.filter((t) => has(t.title) || has(t.location));
    const goals = state.goals.filter((g) => has(g.title) || has(g.category));
    const contacts = state.contacts.filter(
      (c) => has(c.name) || has(c.phone) || has(c.email) || has(c.notes) || (c.tags || []).some(has)
    );
    const notes = state.notes.filter(
      (n) => has(n.title) || has(n.body) || (n.checklist || []).some((i) => has(i.text))
    );
    return { events, tasks, goals, contacts, notes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, state.events, state.tasks, state.goals, state.contacts, state.notes]);

  const total = results
    ? results.events.length + results.tasks.length + results.goals.length + results.contacts.length + results.notes.length
    : 0;

  const openEvent = (ev) =>
    navigate('/planner', { state: { openEventId: ev.id, openEventDate: nearestEventDate(ev) } });
  const openTask = (t) => navigate('/', { state: { openTaskId: t.id } });
  const openNote = (n) => navigate('/', { state: { openNoteId: n.id } });
  const openGoal = () => navigate('/goals');
  const openContact = (c) => navigate(`/contacts/${c.id}`);

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
        <p className="muted center-pad">Search across everything — events, tasks, goals, people, and notes.</p>
      ) : total === 0 ? (
        <p className="muted center-pad">No matches for "{query.trim()}".</p>
      ) : (
        <>
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
