import { useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore, useActions } from '../data/store.jsx';
import Modal from '../components/Modal.jsx';
import EditorSheet from '../components/EditorSheet.jsx';
import Select from '../components/Select.jsx';
import { Avatar, AvatarPicker } from '../components/Avatar.jsx';
import { isOverdue } from './ContactsPage.jsx';
import { syncContactAddressPin } from '../data/geocode.js';
import { useDeleteContactWithUndo } from '../data/useDeleteContact.js';
import {
  todayISO,
  toISODate,
  fromISODate,
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
  const deleteContactWithUndo = useDeleteContactWithUndo();
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [followUpDraft, setFollowUpDraft] = useState(null); // { date, note } | null

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

  const isPro = !!state.settings?.isPro;
  const initialEditJsonRef = useRef('');
  const startEdit = () => {
    const d = {
      ...contact,
      tagsText: (contact.tags || []).join(', '),
      cadenceText: contact.cadenceDays ? String(contact.cadenceDays) : '',
    };
    setEditing(d);
    initialEditJsonRef.current = JSON.stringify(d);
  };
  const editDirty = editing ? JSON.stringify(editing) !== initialEditJsonRef.current : false;

  const saveEdit = () => {
    const name = editing.name.trim();
    if (!name) return;
    const address = editing.address.trim();
    const updated = {
      ...contact,
      name,
      phone: editing.phone.trim(),
      email: editing.email.trim(),
      address,
      photo: editing.photo || '',
      statusId: editing.statusId,
      notes: editing.notes.trim(),
      cadenceDays: Number(editing.cadenceText) || 0,
      tags: editing.tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
    actions.updateContact(updated);
    if (address !== (contact.address || '')) syncContactAddressPin(updated, state, actions);
    setEditing(null);
  };

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
        <Avatar name={contact.name} photo={contact.photo} color={status?.color} size="lg" />
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
        <button
          className="qa"
          onClick={() => (isPro ? navigate(`/contacts/${contact.id}/timeline`) : navigate('/pricing'))}
        >
          <QAIcon kind="timeline" />
          <span>Timeline {!isPro && '🔒'}</span>
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

      {/* Follow-up commitment. Distinct from "last connected", which drifts
          on its own — this is something the user actively promised, so it
          gets a date, shows how overdue it is, and mirrors itself into the
          task list (handled by the store, see SET_FOLLOW_UP). */}
      <section className="detail-section">
        <div className="section-head">
          <span className="detail-label">Follow-up</span>
          {contact.followUp ? (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setFollowUpDraft({ ...contact.followUp })}
            >
              Change
            </button>
          ) : (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() =>
                setFollowUpDraft({ date: toISODate(addDays(new Date(), 7)), note: '' })
              }
            >
              + Add
            </button>
          )}
        </div>
        {contact.followUp ? (
          <div className={`followup-card${contact.followUp.date <= todayISO() ? ' followup-card--due' : ''}`}>
            <div className="followup-main">
              <span className="followup-when">{followUpLabel(contact.followUp.date)}</span>
              {contact.followUp.note && <span className="followup-note">{contact.followUp.note}</span>}
            </div>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                actions.setFollowUp(contact.id, null);
                actions.updateContact({ ...contact, lastContacted: todayISO() });
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <p className="muted small">
            Nothing promised. Add one when you tell {contact.name.split(' ')[0]} you'll be in touch.
          </p>
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

      <button
        className="fab"
        onClick={() => navigate('/planner', { state: { newEventContact: contact.id } })}
        aria-label={`Add an event with ${contact.name}`}
      >
        +
      </button>

      {/* Edit sheet */}
      <EditorSheet
        open={!!editing}
        title="Edit person"
        dirty={editDirty}
        onSave={saveEdit}
        onDiscard={() => setEditing(null)}
        danger={{
          label: 'Delete person',
          onClick: () => {
            setEditing(null);
            setConfirmDelete(true);
          },
        }}
      >
        {editing && (
          <div className="form">
            <AvatarPicker
              name={editing.name}
              photo={editing.photo}
              onChange={(photo) => setEditing({ ...editing, photo })}
            />
            <label className="field">
              <span>Name</span>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            {isPro && (
              <label className="field">
                <span>Status</span>
                <Select
                  value={editing.statusId}
                  onChange={(v) => setEditing({ ...editing, statusId: v })}
                  options={state.statuses.map((s) => ({ value: s.id, label: s.label, color: s.color }))}
                />
              </label>
            )}
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
      </EditorSheet>

      {/* Follow-up editor */}
      <Modal
        open={!!followUpDraft}
        title="Follow up with"
        onClose={() => setFollowUpDraft(null)}
        footer={
          <div className="modal-actions">
            {contact.followUp && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  actions.setFollowUp(contact.id, null);
                  setFollowUpDraft(null);
                }}
              >
                Remove
              </button>
            )}
            <button
              className="btn btn-primary"
              disabled={!followUpDraft?.date}
              onClick={() => {
                actions.setFollowUp(contact.id, {
                  date: followUpDraft.date,
                  note: followUpDraft.note.trim(),
                });
                setFollowUpDraft(null);
              }}
            >
              Save
            </button>
          </div>
        }
      >
        {followUpDraft && (
          <div className="form">
            <label className="field">
              <span>By when</span>
              <input
                type="date"
                value={followUpDraft.date}
                onChange={(e) => setFollowUpDraft({ ...followUpDraft, date: e.target.value })}
              />
            </label>
            <div className="chips">
              {[
                ['Tomorrow', 1],
                ['In 3 days', 3],
                ['Next week', 7],
                ['In 2 weeks', 14],
              ].map(([label, days]) => {
                const iso = toISODate(addDays(new Date(), days));
                return (
                  <button
                    key={label}
                    type="button"
                    className={`chip${followUpDraft.date === iso ? ' chip--on' : ''}`}
                    onClick={() => setFollowUpDraft({ ...followUpDraft, date: iso })}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <label className="field">
              <span>What did you promise?</span>
              <textarea
                rows="2"
                value={followUpDraft.note}
                onChange={(e) => setFollowUpDraft({ ...followUpDraft, note: e.target.value })}
                placeholder="Send them the address"
              />
            </label>
            <p className="muted small">
              This also shows up as a task, so it's in front of you on the days that matter.
            </p>
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
                deleteContactWithUndo(contact);
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

// Relative where it helps ("Overdue by 3 days" is the fact that matters) and
// absolute where it doesn't ("Fri, Aug 8" beats "in 12 days").
function followUpLabel(iso) {
  const today = todayISO();
  if (iso < today) {
    const late = Math.round((fromISODate(today) - fromISODate(iso)) / 86400000);
    return `Overdue by ${late} day${late === 1 ? '' : 's'}`;
  }
  if (iso === today) return 'Due today';
  if (iso === toISODate(addDays(new Date(), 1))) return 'Due tomorrow';
  return `Due ${formatShortDate(fromISODate(iso))}`;
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
  if (kind === 'timeline') {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7.5V12l3.2 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  const paths = {
    call: 'M6.5 3.5c.5 3 2 6 4.5 8.5s5.5 4 8.5 4.5l-1.5 3c-4-.5-8-3-11-6s-5.5-7-6-11z',
    text: 'M4 5h16v11H9l-4 3v-3H4z',
    mail: 'M3 6h18v12H3zM3 6l9 7 9-7',
  };
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={paths[kind]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
