import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore, useActions } from '../data/store.jsx';
import EditorSheet from '../components/EditorSheet.jsx';
import Modal from '../components/Modal.jsx';
import Checkbox from '../components/Checkbox.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { todayISO, toISODate, addDays, formatShortDate, formatTime, expandEventOnDay } from '../data/helpers.js';
import { contactInsights } from '../data/contactInsights.js';
import Icon from '../components/Icon.jsx';

const WINDOW_DAYS = 180; // how far past/future the feed reaches

export default function ContactTimelinePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useStore();
  const actions = useActions();
  const contact = state.contacts.find((c) => c.id === id);
  const status = state.statuses.find((s) => s.id === contact?.statusId);
  const isPro = !!state.settings?.isPro;

  const scrollRef = useRef(null);
  const anchorRef = useRef(null);

  // Collapsed by default: the three next things and the three most recent,
  // with everything else behind "Show full timeline". A relationship of any
  // length produced hundreds of rows, and the two that matter — what's
  // coming and what just happened — were buried in the middle of them.
  const [expanded, setExpanded] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [editingInteraction, setEditingInteraction] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const [viewingNote, setViewingNote] = useState(null); // read view before edit
  const [confirmDelete, setConfirmDelete] = useState(null); // { kind: 'interaction'|'note', id }

  const today = todayISO();

  // Combined chronological feed: calendar events linked to this person
  // (past and future), and logged interactions. Notes live in their own bar
  // above the timeline instead (see contactNotes) rather than being mixed
  // in by date. Sorted newest/future-first so the DOM reads future (top) ->
  // today -> past (bottom): scrolling down moves toward the past, scrolling
  // up moves toward the future, matching the "start on today" anchor below.
  const entries = useMemo(() => {
    if (!contact) return [];
    const out = [];
    for (let i = -WINDOW_DAYS; i <= WINDOW_DAYS; i++) {
      const iso = toISODate(addDays(today, i));
      for (const e of state.events) {
        for (const occ of expandEventOnDay(e, iso)) {
          if (occ.contactId === contact.id) {
            out.push({ type: 'event', date: iso, key: `ev:${occ.id}:${occ.recDate}`, occ });
          }
        }
      }
    }
    for (const ix of state.interactions || []) {
      if (ix.contactId === contact.id) {
        out.push({ type: 'interaction', date: ix.date, key: `ix:${ix.id}`, interaction: ix });
      }
    }
    out.sort((a, b) => b.date.localeCompare(a.date));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.events, state.interactions, contact?.id]);

  // All notes for this contact — pinned first — shown together in their own
  // bar above the timeline rather than interleaved chronologically with
  // events and logged contacts.
  const contactNotes = useMemo(
    () =>
      (state.notes || [])
        .filter((n) => n.contactId === contact?.id)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    [state.notes, contact?.id]
  );

  const insights = useMemo(() => contactInsights(entries, {}), [entries]);

  // `entries` runs newest-first, so future is the head and past is the tail.
  const futureAll = useMemo(() => entries.filter((e) => e.date > today), [entries, today]);
  const pastAll = useMemo(() => entries.filter((e) => e.date <= today), [entries, today]);
  const SHOWN = 3;
  // The nearest three ahead are the *last* three of the future block, since
  // that block is sorted furthest-first.
  const future = expanded ? futureAll : futureAll.slice(-SHOWN);
  const past = expanded ? pastAll : pastAll.slice(0, SHOWN);
  const hiddenCount = futureAll.length - future.length + (pastAll.length - past.length);

  const jumpToToday = () => {
    anchorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

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

  if (!isPro) {
    return (
      <div className="page">
        <header className="page-head">
          <button className="back-btn" onClick={() => navigate(`/contacts/${id}`)}>
            ‹ {contact.name}
          </button>
        </header>
        <div className="empty upgrade-empty">
          <div className="empty-icon"><Icon name="crown" size={48} /></div>
          <h2>Timeline is a Pro feature</h2>
          <p className="muted">
            See a full history of events and logged contact with {contact.name.split(' ')[0]}, plus
            notes you can pin to the top.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/pricing')}>
            See Pro plans
          </button>
        </div>
      </div>
    );
  }

  const saveInteraction = () => {
    const text = editingInteraction.text.trim();
    if (!editingInteraction.date) return;
    if (editingInteraction.id) {
      actions.updateInteraction({ ...editingInteraction, text });
    } else {
      actions.addInteraction({ contactId: contact.id, date: editingInteraction.date, text, createdAt: today });
    }
    setEditingInteraction(null);
  };

  const saveNote = () => {
    const title = editingNote.title.trim();
    const body = editingNote.body.trim();
    if (!title && !body) return;
    if (editingNote.id) {
      actions.updateNote({ ...editingNote, title, body, updatedAt: today });
    } else {
      actions.addNote({ contactId: contact.id, title, body, pinned: editingNote.pinned, createdAt: today, updatedAt: today });
    }
    setEditingNote(null);
  };

  return (
    <div className="page timeline-page">
      <header className="page-head">
        <div className="page-head-row">
          <button className="back-btn" onClick={() => navigate(`/contacts/${id}`)}>
            ‹ {contact.name}
          </button>
          <button className="icon-btn" onClick={jumpToToday} aria-label="Jump to today" title="Jump to today">
            <TimelineTodayIcon />
          </button>
        </div>
      </header>

      {/* The person, tappable — you're looking straight at them and their
          details are one back-tap plus one Edit away, which is two taps too
          many for "actually, her number changed". */}
      <button
        className="detail-hero detail-hero--compact timeline-hero"
        onClick={() => navigate(`/contacts/${id}`, { state: { edit: true } })}
      >
        <Avatar name={contact.name} photo={contact.photo} color={status?.color} size="md" />
        <h1>{contact.name}'s timeline</h1>
        <span className="timeline-hero-edit">
          <Icon name="pencil" size={16} />
        </span>
      </button>

      {insights.length > 0 && (
        <section className="timeline-insights">
          {insights.map((i) => (
            <span key={i.id} className="timeline-insight">
              <Icon name={i.icon} size={14} /> {i.text}
            </span>
          ))}
        </section>
      )}

      {/* Notes sit in the normal flow now. They used to be sticky with their
          own internal scroll, which meant the first one was docked flush
          under a header that fades to transparent and clipped by its own
          overflow — so a pinned note read as faded and cut off at the top.
          Nothing overlays them any more. */}
      {contactNotes.length > 0 && (
        <section className="contact-notes">
          {contactNotes.map((n) => (
            <button
              key={n.id}
              className={`contact-note${n.pinned ? ' contact-note--pinned' : ''}`}
              onClick={() => setViewingNote(n)}
            >
              {n.pinned && <span className="pinned-note-pin"><Icon name="bookmark" size={14} /></span>}
              <span className="pinned-note-body">
                {n.title && <strong>{n.title}</strong>}
                {n.body && <span className="pinned-note-text">{n.body}</span>}
              </span>
            </button>
          ))}
        </section>
      )}

      <div className="timeline-scroll" ref={scrollRef}>
        {entries.length === 0 && (
          <p className="muted center-pad">
            Nothing here yet. Log a contact, add an event, or write a note below.
          </p>
        )}

        {future.map((entry) => (
          <TimelineEntry
            key={entry.key}
            entry={entry}
            onEditInteraction={(ix) => setEditingInteraction({ ...ix })}
          />
        ))}

        {entries.length > 0 && (
          <div ref={anchorRef} className="timeline-today-marker">
            <span>Today</span>
          </div>
        )}

        {past.map((entry) => (
          <TimelineEntry
            key={entry.key}
            entry={entry}
            onEditInteraction={(ix) => setEditingInteraction({ ...ix })}
          />
        ))}

        {hiddenCount > 0 && !expanded && (
          <button className="timeline-more" onClick={() => setExpanded(true)}>
            Show full timeline
            <span className="muted small"> · {hiddenCount} more</span>
          </button>
        )}
        {expanded && (
          <button className="timeline-more" onClick={() => setExpanded(false)}>
            Show less
          </button>
        )}
      </div>

      <button className="fab" onClick={() => setAddMenuOpen(true)} aria-label="Add to timeline">
        +
      </button>

      {/* Add menu */}
      <Modal open={addMenuOpen} title="Add to timeline" onClose={() => setAddMenuOpen(false)}>
        <div className="stack-btns">
          <button
            className="btn btn-ghost full"
            onClick={() => {
              setAddMenuOpen(false);
              setEditingInteraction({ date: today, text: '' });
            }}
          >
            <Icon name="personCheck" /> Log a contact
          </button>
          <button
            className="btn btn-ghost full"
            onClick={() => {
              setAddMenuOpen(false);
              navigate('/planner', { state: { newEventContact: contact.id } });
            }}
          >
            <Icon name="calendar" /> Add an event
          </button>
          <button
            className="btn btn-ghost full"
            onClick={() => {
              setAddMenuOpen(false);
              setEditingNote({ title: '', body: '', pinned: false });
            }}
          >
            <Icon name="note" /> Write a note
          </button>
        </div>
      </Modal>

      {/* Interaction editor */}
      <EditorSheet
        open={!!editingInteraction}
        title={editingInteraction?.id ? 'Edit logged contact' : 'Log a contact'}
        dirty={!!editingInteraction}
        onSave={saveInteraction}
        onDiscard={() => setEditingInteraction(null)}
        danger={
          editingInteraction?.id
            ? {
                label: 'Delete',
                onClick: () => {
                  setConfirmDelete({ kind: 'interaction', id: editingInteraction.id });
                  setEditingInteraction(null);
                },
              }
            : undefined
        }
      >
        {editingInteraction && (
          <div className="form">
            <label className="field">
              <span>Date</span>
              <input
                type="date"
                value={editingInteraction.date}
                onChange={(e) => setEditingInteraction({ ...editingInteraction, date: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Notes</span>
              <textarea
                rows="3"
                value={editingInteraction.text}
                onChange={(e) => setEditingInteraction({ ...editingInteraction, text: e.target.value })}
                placeholder="What happened — a call, a visit, anything worth remembering"
              />
            </label>
          </div>
        )}
      </EditorSheet>

      {/* Note editor */}
      <EditorSheet
        open={!!editingNote}
        title={editingNote?.id ? 'Edit note' : 'New note'}
        dirty={!!editingNote}
        onSave={saveNote}
        onDiscard={() => setEditingNote(null)}
        danger={
          editingNote?.id
            ? {
                label: 'Delete note',
                onClick: () => {
                  setConfirmDelete({ kind: 'note', id: editingNote.id });
                  setEditingNote(null);
                },
              }
            : undefined
        }
      >
        {editingNote && (
          <div className="form">
            <label className="field">
              <span>Title</span>
              <input
                value={editingNote.title}
                onChange={(e) => setEditingNote({ ...editingNote, title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Note</span>
              <textarea
                rows="4"
                value={editingNote.body}
                onChange={(e) => setEditingNote({ ...editingNote, body: e.target.value })}
              />
            </label>
            <label className="check-row">
              <Checkbox
                checked={!!editingNote.pinned}
                onChange={(e) => setEditingNote({ ...editingNote, pinned: e.target.checked })}
                ariaLabel="Pin to top of timeline"
              />
              <span><Icon name="bookmark" size={15} /> Pin to top of timeline</span>
            </label>
          </div>
        )}
      </EditorSheet>

      {/* Delete confirm */}
      {/* Reading a note, before editing it. A note only ever showed one
          ellipsised line in the list, and tapping it dropped you straight
          into a textarea — fine for changing it, wrong for the far more
          common case of just wanting to read the thing. */}
      <Modal
        open={!!viewingNote}
        title={viewingNote?.title || 'Note'}
        onClose={() => setViewingNote(null)}
        footer={
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setViewingNote(null)}>
              Close
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setEditingNote({ ...viewingNote });
                setViewingNote(null);
              }}
            >
              Edit
            </button>
          </div>
        }
      >
        {viewingNote && (
          <div className="note-reader selectable">
            {viewingNote.body ? (
              <p>{viewingNote.body}</p>
            ) : (
              <p className="muted">This note is empty.</p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!confirmDelete}
        title={confirmDelete?.kind === 'note' ? 'Delete note?' : 'Delete logged contact?'}
        onClose={() => setConfirmDelete(null)}
        footer={
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                if (confirmDelete.kind === 'note') actions.deleteNote(confirmDelete.id);
                else actions.deleteInteraction(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Delete
            </button>
          </div>
        }
      >
        <p>This can't be undone.</p>
      </Modal>
    </div>
  );
}

function TimelineEntry({ entry, onEditInteraction }) {
  if (entry.type === 'event') {
    const { occ } = entry;
    return (
      <div className="timeline-item timeline-item--event">
        <span className="timeline-item-date">
          {formatShortDate(entry.date)}
          <small>{formatTime(occ.start)}</small>
        </span>
        <span className="timeline-item-body">
          <strong>{occ.title || 'Untitled event'}</strong>
          {occ.repeat && occ.repeat !== 'none' && <span className="repeat-glyph"> <Icon name="repeat" size={13} /></span>}
        </span>
      </div>
    );
  }
  const ix = entry.interaction;
  return (
    <button className="timeline-item timeline-item--interaction" onClick={() => onEditInteraction(ix)}>
      <span className="timeline-item-date">{formatShortDate(entry.date)}</span>
      <span className="timeline-item-body">
        <strong><Icon name="personCheck" size={15} /> Contact logged</strong>
        {ix.text && <span className="timeline-item-text">{ix.text}</span>}
      </span>
    </button>
  );
}

function TimelineTodayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    </svg>
  );
}
