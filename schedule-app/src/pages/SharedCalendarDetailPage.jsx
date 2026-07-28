import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { useStore } from '../data/store.jsx';
import EditorSheet from '../components/EditorSheet.jsx';
import Modal from '../components/Modal.jsx';
import { CLERK_ENABLED } from '../data/clerkConfig.js';
import {
  backendConfigured,
  fetchCalendar,
  removeCalendarMember,
  inviteToCalendar,
  addSharedEvent,
  updateSharedEvent,
  deleteSharedEvent,
} from '../data/api.js';
import { formatShortDate, formatTime } from '../data/helpers.js';
import Icon from '../components/Icon.jsx';

export default function SharedCalendarDetailPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const isPro = !!state.settings?.isPro;

  // The list page explains the "not connected" state — landing here
  // directly (bookmark, back button) just bounces back to it. Navigating
  // during render (rather than an effect) isn't safe/reliable in React, so
  // both redirect cases live in the same effect.
  useEffect(() => {
    if (!isPro) navigate('/pricing', { replace: true });
    else if (!CLERK_ENABLED || !backendConfigured()) navigate('/shared-calendars', { replace: true });
  }, [isPro, navigate]);

  if (!isPro || !CLERK_ENABLED || !backendConfigured()) return null;

  return <SharedCalendarDetailInner />;
}

function SharedCalendarDetailInner() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const [info, setInfo] = useState(null); // { calendar, role, members, events } | null
  const [error, setError] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [editingEvent, setEditingEvent] = useState(null);

  const load = async () => {
    setError('');
    try {
      const data = await fetchCalendar(getToken, id);
      setInfo(data);
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) {
    return (
      <div className="page">
        <header className="page-head">
          <button className="back-btn" onClick={() => navigate('/shared-calendars')}>
            ‹ Shared calendars
          </button>
        </header>
        <p className="muted center-pad">{error}</p>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="page">
        <header className="page-head">
          <button className="back-btn" onClick={() => navigate('/shared-calendars')}>
            ‹ Shared calendars
          </button>
        </header>
        <p className="muted center-pad">Loading…</p>
      </div>
    );
  }

  const canEdit = info.role === 'owner' || info.role === 'editor';

  const sendInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    try {
      const { invite } = await inviteToCalendar(getToken, id, email);
      setInviteLink(`${window.location.origin}${window.location.pathname}#/shared-calendars/join/${invite.token}`);
      setInviteEmail('');
    } catch (err) {
      setError(err.message);
    }
  };

  const removeMember = async (memberId) => {
    try {
      await removeCalendarMember(getToken, id, memberId);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const openNewEvent = () => setEditingEvent({ title: '', date: '', start: '', end: '', notes: '' });
  const openEditEvent = (e) => setEditingEvent({ ...e });
  const saveEvent = async () => {
    const { title, date, start, end, notes } = editingEvent;
    if (!title.trim() || !date || !start || !end) return;
    try {
      if (editingEvent.id) {
        await updateSharedEvent(getToken, id, editingEvent.id, { title, date, start, end, notes });
      } else {
        await addSharedEvent(getToken, id, { title, date, start, end, notes });
      }
      setEditingEvent(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const removeEvent = async () => {
    try {
      await deleteSharedEvent(getToken, id, editingEvent.id);
      setEditingEvent(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-row">
          <button className="back-btn" onClick={() => navigate('/shared-calendars')}>
            ‹ Shared calendars
          </button>
          {canEdit && (
            <button className="btn btn-ghost btn-sm" onClick={() => setInviteOpen(true)}>
              + Invite
            </button>
          )}
        </div>
        <h1>{info.calendar.name}</h1>
      </header>

      <section className="detail-section">
        <span className="detail-label">People</span>
        <ul className="place-list">
          {info.members.map((m) => (
            <li key={m.id}>
              <div className="place-row">
                <span className="place-emoji">
                  <Icon name={m.role === 'owner' ? 'crown' : 'person'} size={20} />
                </span>
                <span className="place-label">
                  {m.email} <span className="muted small">· {m.role}</span>
                </span>
                {info.role === 'owner' && m.role !== 'owner' && (
                  <button className="icon-btn" onClick={() => removeMember(m.id)} aria-label="Remove person">
                    <Icon name="close" size={16} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="detail-section">
        <div className="section-head">
          <span className="detail-label">Events</span>
          {canEdit && (
            <button className="btn btn-ghost btn-sm" onClick={openNewEvent}>
              + Add
            </button>
          )}
        </div>
        {info.events.length === 0 ? (
          <p className="muted small">No events yet.</p>
        ) : (
          <ul className="mini-events">
            {info.events.map((e) => (
              <li key={e.id}>
                <button
                  className="mini-event-row"
                  onClick={() => canEdit && openEditEvent(e)}
                  disabled={!canEdit}
                >
                  <span className="mini-date">
                    {formatShortDate(e.date)}
                    <small>{formatTime(e.start)}</small>
                  </span>
                  <span className="mini-title">{e.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={inviteOpen}
        title="Invite someone"
        onClose={() => {
          setInviteOpen(false);
          setInviteLink('');
        }}
        footer={
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={sendInvite}>
              Create invite
            </button>
          </div>
        }
      >
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="them@example.com"
          />
        </label>
        <p className="muted small">
          Keystone doesn't send the invite email itself — copy this link and send it to them
          yourself once it's created.
        </p>
        {inviteLink && (
          <p className="muted small">
            <code>{inviteLink}</code>
          </p>
        )}
      </Modal>

      <EditorSheet
        open={!!editingEvent}
        title={editingEvent?.id ? 'Edit event' : 'New event'}
        dirty={!!editingEvent?.title?.trim()}
        onSave={saveEvent}
        onDiscard={() => setEditingEvent(null)}
        danger={editingEvent?.id ? { label: 'Delete event', onClick: removeEvent } : undefined}
      >
        {editingEvent && (
          <div className="form">
            <label className="field">
              <span>Title</span>
              <input
                value={editingEvent.title}
                onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Date</span>
              <input
                type="date"
                value={editingEvent.date}
                onChange={(e) => setEditingEvent({ ...editingEvent, date: e.target.value })}
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Start</span>
                <input
                  type="time"
                  value={editingEvent.start}
                  onChange={(e) => setEditingEvent({ ...editingEvent, start: e.target.value })}
                />
              </label>
              <label className="field">
                <span>End</span>
                <input
                  type="time"
                  value={editingEvent.end}
                  onChange={(e) => setEditingEvent({ ...editingEvent, end: e.target.value })}
                />
              </label>
            </div>
            <label className="field">
              <span>Notes</span>
              <textarea
                rows="3"
                value={editingEvent.notes}
                onChange={(e) => setEditingEvent({ ...editingEvent, notes: e.target.value })}
              />
            </label>
          </div>
        )}
      </EditorSheet>
    </div>
  );
}
