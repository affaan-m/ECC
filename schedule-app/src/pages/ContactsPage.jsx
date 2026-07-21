import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useActions } from '../data/store.jsx';
import Modal from '../components/Modal.jsx';
import { daysAgoLabel } from '../data/helpers.js';

export default function ContactsPage() {
  const { state } = useStore();
  const actions = useActions();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(''); // statusId or ''
  const [adding, setAdding] = useState(null);

  const statusById = useMemo(
    () => Object.fromEntries(state.statuses.map((s) => [s.id, s])),
    [state.statuses]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.contacts
      .filter((c) => (filter ? c.statusId === filter : true))
      .filter((c) =>
        q
          ? c.name.toLowerCase().includes(q) ||
            (c.tags || []).some((t) => t.toLowerCase().includes(q)) ||
            (c.notes || '').toLowerCase().includes(q)
          : true
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state.contacts, query, filter]);

  const startAdd = () =>
    setAdding({
      name: '',
      phone: '',
      email: '',
      address: '',
      statusId: state.statuses[0]?.id || '',
      tagsText: '',
      notes: '',
    });

  const saveNew = () => {
    const name = adding.name.trim();
    if (!name) return;
    actions.addContact({
      name,
      phone: adding.phone.trim(),
      email: adding.email.trim(),
      address: adding.address.trim(),
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
          <h1>People</h1>
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
            return (
              <li key={c.id}>
                <button className="contact-row" onClick={() => navigate(`/contacts/${c.id}`)}>
                  <span className="avatar" style={{ background: st?.color || 'var(--muted)' }}>
                    {initials(c.name)}
                  </span>
                  <span className="contact-main">
                    <span className="contact-name">{c.name}</span>
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

      <Modal
        open={!!adding}
        title="Add person"
        onClose={() => setAdding(null)}
        footer={
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={saveNew}>
              Save
            </button>
          </div>
        }
      >
        {adding && (
          <div className="form">
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
              <select
                value={adding.statusId}
                onChange={(e) => setAdding({ ...adding, statusId: e.target.value })}
              >
                {state.statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
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
      </Modal>
    </div>
  );
}

export function initials(name) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="row-chevron">
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
