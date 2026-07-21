import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useActions } from '../data/store.jsx';
import EditorSheet from '../components/EditorSheet.jsx';
import Select from '../components/Select.jsx';
import { Avatar, AvatarPicker } from '../components/Avatar.jsx';
import { Brand } from '../components/Logo.jsx';
import { daysAgoLabel, daysSince, todayISO } from '../data/helpers.js';

// A contact is "overdue" when the time since last contact (or since they were
// added, if never contacted) meets or exceeds their reconnect cadence.
export function reconnectDaysOf(contact, defaultDays) {
  const days = Number(contact.cadenceDays) || defaultDays;
  return days > 0 ? days : 0;
}
export function isOverdue(contact, defaultDays) {
  const days = reconnectDaysOf(contact, defaultDays);
  if (!days) return false;
  return daysSince(contact.lastContacted || contact.createdAt) >= days;
}

export default function ContactsPage() {
  const { state } = useStore();
  const actions = useActions();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(''); // statusId, '__overdue', or ''
  const [adding, setAdding] = useState(null);

  const reconnectDays = state.settings?.reconnectDays ?? 30;

  const statusById = useMemo(
    () => Object.fromEntries(state.statuses.map((s) => [s.id, s])),
    [state.statuses]
  );

  const overdue = useMemo(
    () =>
      state.contacts
        .filter((c) => isOverdue(c, reconnectDays))
        .sort(
          (a, b) =>
            daysSince(b.lastContacted || b.createdAt) - daysSince(a.lastContacted || a.createdAt)
        ),
    [state.contacts, reconnectDays]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.contacts
      .filter((c) =>
        filter === '__overdue'
          ? isOverdue(c, reconnectDays)
          : filter
          ? c.statusId === filter
          : true
      )
      .filter((c) =>
        q
          ? c.name.toLowerCase().includes(q) ||
            (c.tags || []).some((t) => t.toLowerCase().includes(q)) ||
            (c.notes || '').toLowerCase().includes(q)
          : true
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state.contacts, query, filter, reconnectDays]);

  const showBanner = !query.trim() && filter === '' && overdue.length > 0;

  const initialAddJsonRef = useRef('');
  const startAdd = () => {
    const d = {
      name: '',
      phone: '',
      email: '',
      address: '',
      photo: '',
      statusId: state.statuses[0]?.id || '',
      tagsText: '',
      notes: '',
    };
    setAdding(d);
    initialAddJsonRef.current = JSON.stringify(d);
  };
  const addDirty = adding ? JSON.stringify(adding) !== initialAddJsonRef.current : false;

  const saveNew = () => {
    const name = adding.name.trim();
    if (!name) return;
    actions.addContact({
      name,
      phone: adding.phone.trim(),
      email: adding.email.trim(),
      address: adding.address.trim(),
      photo: adding.photo || '',
      statusId: adding.statusId,
      tags: adding.tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      notes: adding.notes.trim(),
      lastContacted: '',
      createdAt: new Date().toISOString().slice(0, 10),
    });
    setAdding(null);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-row">
          <Brand>People</Brand>
          <button className="btn btn-primary btn-sm" onClick={startAdd}>
            + Add
          </button>
        </div>
        <input
          className="search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, tag, or note"
        />
        <div className="chips">
          <button className={`chip${!filter ? ' chip--on' : ''}`} onClick={() => setFilter('')}>
            All
          </button>
          {overdue.length > 0 && (
            <button
              className={`chip chip--alert${filter === '__overdue' ? ' chip--on' : ''}`}
              onClick={() => setFilter(filter === '__overdue' ? '' : '__overdue')}
            >
              Reconnect · {overdue.length}
            </button>
          )}
          {state.statuses.map((s) => (
            <button
              key={s.id}
              className={`chip${filter === s.id ? ' chip--on' : ''}`}
              style={filter === s.id ? { background: s.color, borderColor: s.color, color: '#fff' } : { borderColor: s.color, color: s.color }}
              onClick={() => setFilter(filter === s.id ? '' : s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      {showBanner && (
        <section className="reconnect">
          <div className="reconnect-head">
            <span>🔔 Time to reconnect</span>
          </div>
          <div className="reconnect-scroll">
            {overdue.slice(0, 12).map((c) => {
              const st = statusById[c.statusId];
              return (
                <div key={c.id} className="reconnect-card">
                  <button className="reconnect-open" onClick={() => navigate(`/contacts/${c.id}`)}>
                    <Avatar name={c.name} photo={c.photo} color={st?.color} size="sm" />
                    <span className="reconnect-name">{c.name.split(' ')[0]}</span>
                    <span className="reconnect-ago">{daysAgoLabel(c.lastContacted)}</span>
                  </button>
                  <button
                    className="btn btn-ghost btn-sm reconnect-log"
                    onClick={() => actions.updateContact({ ...c, lastContacted: todayISO() })}
                  >
                    ✓ Log
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {state.contacts.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">👋</div>
          <h2>Add the people who matter</h2>
          <p className="muted">
            Keep track of friends, family, and anyone you want to stay close to —
            with statuses you define and a nudge when it's been a while.
          </p>
          <button className="btn btn-primary" onClick={startAdd}>
            + Add someone
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="muted center-pad">No one matches that search.</p>
      ) : (
        <ul className="contact-list">
          {filtered.map((c) => {
            const st = statusById[c.statusId];
            const over = isOverdue(c, reconnectDays);
            return (
              <li key={c.id}>
                <button className="contact-row" onClick={() => navigate(`/contacts/${c.id}`)}>
                  <span className="avatar-slot">
                    <Avatar name={c.name} photo={c.photo} color={st?.color} />
                    {over && <span className="overdue-dot" aria-hidden="true" />}
                  </span>
                  <span className="contact-main">
                    <span className="contact-name">
                      {c.name}
                      {over && <span className="overdue-tag">Reconnect</span>}
                    </span>
                    <span className="contact-sub muted">
                      {st && <span className="dot-badge" style={{ color: st.color }}>{st.label}</span>}
                      {st && ' · '}
                      Last: {daysAgoLabel(c.lastContacted)}
                    </span>
                  </span>
                  <Chevron />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <EditorSheet open={!!adding} title="Add person" dirty={addDirty} onSave={saveNew} onDiscard={() => setAdding(null)}>
        {adding && (
          <div className="form">
            <AvatarPicker
              name={adding.name || '?'}
              photo={adding.photo}
              onChange={(photo) => setAdding({ ...adding, photo })}
            />
            <label className="field">
              <span>Name</span>
              <input
                autoFocus
                value={adding.name}
                onChange={(e) => setAdding({ ...adding, name: e.target.value })}
                placeholder="Full name"
              />
            </label>
            <label className="field">
              <span>Status</span>
              <Select
                value={adding.statusId}
                onChange={(v) => setAdding({ ...adding, statusId: v })}
                options={state.statuses.map((s) => ({ value: s.id, label: s.label, color: s.color }))}
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Phone</span>
                <input
                  type="tel"
                  value={adding.phone}
                  onChange={(e) => setAdding({ ...adding, phone: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={adding.email}
                  onChange={(e) => setAdding({ ...adding, email: e.target.value })}
                />
              </label>
            </div>
            <label className="field">
              <span>Tags</span>
              <input
                value={adding.tagsText}
                onChange={(e) => setAdding({ ...adding, tagsText: e.target.value })}
                placeholder="family, work (comma separated)"
              />
            </label>
            <label className="field">
              <span>Notes</span>
              <textarea
                rows="2"
                value={adding.notes}
                onChange={(e) => setAdding({ ...adding, notes: e.target.value })}
              />
            </label>
          </div>
        )}
      </EditorSheet>
    </div>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="row-chevron">
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
