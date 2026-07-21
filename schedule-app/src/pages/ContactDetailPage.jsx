import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore, useActions } from '../data/store.jsx';
import Modal from '../components/Modal.jsx';
import { initials, isOverdue } from './ContactsPage.jsx';
import {
  todayISO,
  toISODate,
  addDays,
  daysAgoLabel,
  formatShortDate,
  formatTime,
  expandEventOnDay,
} from '../data/helpers.js';

export default function ContactDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useStore();
  const actions = useActions();
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const contact = state.contacts.find((c) => c.id === id);
  const status = state.statuses.find((s) => s.id === contact?.statusId);
  const reconnectDays = state.settings?.reconnectDays ?? 30;
  const over = contact ? isOverdue(contact, reconnectDays) : false;

  const linkedPins = useMemo(
    () => (state.pins || []).filter((p) => p.contactId === id),
    [state.pins, id]
  );

  // Expand the next occurrences (including recurring events, honoring any
  // per-occurrence edits) over ~60 days. An event counts if its master OR the
  // specific occurrence is linked to this contact.
  const upcoming = useMemo(() => {
    if (!contact) return [];
    const out = [];
    const today = todayISO();
    for (let i = 0; i < 60 && out.length < 5; i++) {
      const iso = toISODate(addDays(today, i));
      for (const e of state.events) {
        for (const occ of expandEventOnDay(e, iso)) {
          if (occ.contactId === contact.id) out.push(occ);
        }
      }
    }
    return out.slice(0, 5);
  }, [state.events, contact]);

  if (!contact) {
    return (
      <div className="page">
        <header className="page-head">
          <button className="back-btn" onClick={() => navigate('/contacts')}>
            ‹ People
          </button>
        </header>
        <p className="muted center-pad">This person no longer exists.</p>
      </div>
    );
  }

  const startEdit = () =>
    setEditing({
      ...contact,
      tagsText: (contact.tags || []).join(', '),
      cadenceText: contact.cadenceDays ? String(contact.cadenceDays) : '',
    });

  const saveEdit = () => {
    const name = editing.name.trim();
    if (!name) return;
    actions.updateContact({
      ...contact,
      name,
      phone: editing.phone.trim(),
      email: editing.email.trim(),
      address: editing.address.trim(),
      statusId: editing.statusId,
      notes: editing.notes.trim(),
      cadenceDays: Number(editing.cadenceText) || 0,
      tags: editing.tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
    setEditing(null);
  };

  const logContact = () =>
    actions.updateContact({ ...contact, lastContacted: todayISO() });

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-row">
          <button className="back-btn" onClick={() => navigate('/contacts')}>
            ‹ People
          </button>
          <button className="btn btn-ghost btn-sm" onClick={startEdit}>
            Edit
          </button>
        </div>
      </header>

      <div className="detail-hero">
        <span className="avatar avatar--lg" style={{ background: status?.color || 'var(--muted)' }}>
          {initials(contact.name)}
        </span>
        <h1>{contact.name}</h1>
        {status && (
          <span className="status-pill" style={{ background: status.color }}>
            {status.label}
          </span>
        )}
        <p className="muted last-line">Last connected: {daysAgoLabel(contact.lastContacted)}</p>
        {over && <span className="reconnect-chip">🔔 Time to reconnect</span>}
      </div>

      <div className="quick-actions">
        {contact.phone && (
          <a className="qa" href={`tel:${contact.phone}`}>
            <QAIcon kind="call" />
            <span>Call</span>
          </a>
        )}
        {contact.phone && (
          <a className="qa" href={`sms:${contact.phone}`}>
            <QAIcon kind="text" />
            <span>Text</span>
          </a>
        )}
        {contact.email && (
          <a className="qa" href={`mailto:${contact.email}`}>
            <QAIcon kind="mail" />
            <span>Email</span>
          </a>
        )}
        <button className="qa" onClick={logContact}>
          <QAIcon kind="check" />
          <span>Log today</span>
        </button>
      </div>

      <section className="detail-section">
        {contact.phone && <Field label="Phone" value={contact.phone} href={`tel:${contact.phone}`} />}
        {contact.email && <Field label="Email" value={contact.email} href={`mailto:${contact.email}`} />}
        {contact.address && <Field label="Address" value={contact.address} />}
        {(contact.tags || []).length > 0 && (
          <div className="detail-field">
            <span className="detail-label">Tags</span>
            <span className="tag-wrap">
              {contact.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </span>
          </div>
        )}
      </section>

      {contact.notes && (
        <section className="detail-section">
          <span className="detail-label">Notes</span>
          <p className="notes-text">{contact.notes}</p>
        </section>
      )}

      <section className="detail-section">
        <div className="section-head">
          <span className="detail-label">Places</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/map', { state: { placeForContact: contact.id } })}
          >
            + Add a place
          </button>
        </div>
        {linkedPins.length === 0 ? (
          <p className="muted">No places pinned yet. Add {contact.name.split(' ')[0]}'s home or a spot you meet.</p>
        ) : (
          <ul className="place-list">
            {linkedPins.map((p) => (
              <li key={p.id}>
                <button
                  className="place-row"
                  onClick={() => navigate('/map', { state: { selectPin: p.id } })}
                >
                  <span className="place-emoji">{p.emoji || '📍'}</span>
                  <span className="place-label">{p.label || 'Dropped pin'}</span>
                  <span className="place-go muted">View ›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail-section">
        <span className="detail-label">Upcoming together</span>
        {upcoming.length === 0 ? (
          <p className="muted">Nothing scheduled. Add an event in the Planner and link {contact.name.split(' ')[0]}.</p>
        ) : (
          <ul className="mini-events">
            {upcoming.map((e) => (
              <li key={`${e.id}:${e.recDate}`}>
                <span className="mini-date">
                  {formatShortDate(e.occDate)}
                  <small>{formatTime(e.start)}</small>
                </span>
                <span className="mini-title">
                  {e.title}
                  {e.repeat && e.repeat !== 'none' && (
                    <span className="repeat-glyph"> {e.isException ? '✎' : '↻'}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button className="btn btn-danger-ghost full" onClick={() => setConfirmDelete(true)}>
        Delete person
      </button>

      <button
        className="fab"
        onClick={() => navigate('/planner', { state: { newEventContact: contact.id } })}
        aria-label={`Add an event with ${contact.name}`}
      >
        +
      </button>

      {/* Edit modal */}
      <Modal
        open={!!editing}
        title="Edit person"
        onClose={() => setEditing(null)}
        footer={
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={saveEdit}>
              Save
            </button>
          </div>
        }
      >
        {editing && (
          <div className="form">
            <label className="field">
              <span>Name</span>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <label className="field">
              <span>Status</span>
              <select
                value={editing.statusId}
                onChange={(e) => setEditing({ ...editing, statusId: e.target.value })}
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
                <input type="tel" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
              </label>
              <label className="field">
                <span>Email</span>
                <input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Address</span>
              <input value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            </label>
            <label className="field">
              <span>Tags</span>
              <input
                value={editing.tagsText}
                onChange={(e) => setEditing({ ...editing, tagsText: e.target.value })}
                placeholder="comma separated"
              />
            </label>
            <label className="field">
              <span>Remind me to reconnect every</span>
              <div className="cadence-row">
                <input
                  type="number"
                  min="0"
                  value={editing.cadenceText}
                  onChange={(e) => setEditing({ ...editing, cadenceText: e.target.value })}
                  placeholder={String(reconnectDays)}
                />
                <span className="muted">days {editing.cadenceText ? '' : `(default ${reconnectDays})`}</span>
              </div>
            </label>
            <label className="field">
              <span>Notes</span>
              <textarea rows="3" value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </label>
          </div>
        )}
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={confirmDelete}
        title="Delete person?"
        onClose={() => setConfirmDelete(false)}
        footer={
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                actions.deleteContact(contact.id);
                navigate('/contacts');
              }}
            >
              Delete
            </button>
          </div>
        }
      >
        <p>
          Remove <strong>{contact.name}</strong> permanently? This can't be undone.
        </p>
      </Modal>
    </div>
  );
}

function Field({ label, value, href }) {
  return (
    <div className="detail-field">
      <span className="detail-label">{label}</span>
      {href ? (
        <a className="detail-value link" href={href}>
          {value}
        </a>
      ) : (
        <span className="detail-value">{value}</span>
      )}
    </div>
  );
}

function QAIcon({ kind }) {
  const paths = {
    call: 'M6.5 3.5c.5 3 2 6 4.5 8.5s5.5 4 8.5 4.5l-1.5 3c-4-.5-8-3-11-6s-5.5-7-6-11z',
    text: 'M4 5h16v11H9l-4 3v-3H4z',
    mail: 'M3 6h18v12H3zM3 6l9 7 9-7',
    check: 'M4 12l5 5 11-11',
  };
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={paths[kind]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
