import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore, useActions } from '../data/store.jsx';
import EditorSheet from '../components/EditorSheet.jsx';
import Modal from '../components/Modal.jsx';
import Checkbox from '../components/Checkbox.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { todayISO, toISODate, addDays, formatShortDate, formatTime, expandEventOnDay } from '../data/helpers.js';

const WINDOW_DAYS = 180; // how far past/future the feed reaches

export default function ContactTimelinePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useStore();
  const actions = useActions();
  const contact = state.contacts.find((c) => c.id === id);
  const isPro = !!state.settings?.isPro;

  const scrollRef = useRef(null);
  const anchorRef = useRef(null);
  const didLandRef = useRef(false);
  const headerRef = useRef(null);
  const notesRef = useRef(null);
  const [notesTop, setNotesTop] = useState(56);
  const [fadeTop, setFadeTop] = useState(56);

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [editingInteraction, setEditingInteraction] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
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

  // Future events beyond the first few fade at the top of the timeline
  // until the user actually scrolls up to reveal them. The fade's opacity
  // tracks scroll position directly (instead of a hard on/off toggle) so it
  // eases in and out smoothly as you scroll, rather than snapping.
  const futureCount = useMemo(() => entries.filter((e) => e.type === 'event' && e.date > today).length, [entries, today]);
  const FADE_SCROLL_RANGE = 40; // px of scroll over which the fade eases in
  const [scrollY, setScrollY] = useState(0);
  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const fadeOpacity = Math.max(0, Math.min(1, scrollY / FADE_SCROLL_RANGE));

  // Dock the notes bar right below the sticky header, and the fade right
  // below the (also sticky) notes bar — so the notes stay reachable at any
  // scroll position instead of being landed-past on open, and the fade only
  // ever covers the actual event list, never the notes themselves.
  useEffect(() => {
    const measure = () => {
      const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? 56;
      setNotesTop(headerBottom);
      const notesHeight = notesRef.current?.getBoundingClientRect().height ?? 0;
      setFadeTop(headerBottom + notesHeight);
    };
    measure();
    // The page's mount-in animation (see .page's page-in keyframes) can
    // still be settling when this first runs, giving a slightly-off
    // reading — one more pass after it finishes catches the resting layout.
    const settleTimer = setTimeout(measure, 450);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(settleTimer);
      window.removeEventListener('resize', measure);
    };
  }, [contactNotes.length]);

  // Index of the first entry that's today-or-earlier: everything above it in
  // the (descending) list is future, this is the "now" anchor to land on.
  const anchorIndex = useMemo(() => {
    const idx = entries.findIndex((e) => e.date <= today);
    return idx === -1 ? entries.length : idx;
  }, [entries, today]);

  // Land on "today" the moment the page opens — instant, not an animated
  // scroll the user didn't ask for. A later "Jump to today" tap (if added)
  // can use smooth scrolling instead.
  useEffect(() => {
    didLandRef.current = false;
  }, [contact?.id]);
  useEffect(() => {
    if (didLandRef.current || !anchorRef.current) return;
    anchorRef.current.scrollIntoView({ block: 'start' });
    didLandRef.current = true;
  }, [entries, anchorIndex]);

  const jumpToToday = () => {
    anchorRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
          <div className="empty-icon">👑</div>
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
      <header className="page-head" ref={headerRef}>
        <div className="page-head-row">
          <button className="back-btn" onClick={() => navigate(`/contacts/${id}`)}>
            ‹ {contact.name}
          </button>
          <button className="icon-btn" onClick={jumpToToday} aria-label="Jump to today" title="Jump to today">
            <TimelineTodayIcon />
          </button>
        </div>
      </header>

      <div className="detail-hero detail-hero--compact">
        <Avatar name={contact.name} photo={contact.photo} size="md" />
        <h1>{contact.name}'s timeline</h1>
      </div>

      {contactNotes.length > 0 && (
        <section className="contact-notes" ref={notesRef} style={{ top: notesTop }}>
          {contactNotes.map((n) => (
            <button
              key={n.id}
              className={`contact-note${n.pinned ? ' contact-note--pinned' : ''}`}
              onClick={() => setEditingNote({ ...n })}
            >
              {n.pinned && <span className="pinned-note-pin">📌</span>}
              <span className="pinned-note-body">
                {n.title && <strong>{n.title}</strong>}
                {n.body && <span className="pinned-note-text">{n.body}</span>}
              </span>
            </button>
          ))}
        </section>
      )}

      {futureCount > 3 && (
        <div className="timeline-fade-top" style={{ top: fadeTop, opacity: fadeOpacity }} />
      )}

      <div className="timeline-scroll" ref={scrollRef}>
        {entries.length === 0 && (
          <p className="muted center-pad">
            Nothing here yet. Log a contact, add an event, or write a note below.
          </p>
        )}
        {entries.map((entry, i) => (
          <div key={entry.key}>
            {i === anchorIndex && (
              <div ref={anchorRef} className="timeline-today-marker">
                <span>Today</span>
              </div>
            )}
            <TimelineEntry
              entry={entry}
              onEditInteraction={(ix) => setEditingInteraction({ ...ix })}
              onDeleteInteraction={(ixId) => setConfirmDelete({ kind: 'interaction', id: ixId })}
            />
          </div>
        ))}
        {anchorIndex >= entries.length && (
          <div ref={anchorRef} className="timeline-today-marker">
            <span>Today</span>
          </div>
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
            🤝 Log a contact
          </button>
          <button
            className="btn btn-ghost full"
            onClick={() => {
              setAddMenuOpen(false);
              navigate('/planner', { state: { newEventContact: contact.id } });
            }}
          >
            📅 Add an event
          </button>
          <button
            className="btn btn-ghost full"
            onClick={() => {
              setAddMenuOpen(false);
              setEditingNote({ title: '', body: '', pinned: false });
            }}
          >
            📝 Write a note
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
                autoFocus
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
                autoFocus
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
              <span>📌 Pin to top of timeline</span>
            </label>
          </div>
        )}
      </EditorSheet>

      {/* Delete confirm */}
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
          {occ.repeat && occ.repeat !== 'none' && <span className="repeat-glyph"> ↻</span>}
        </span>
      </div>
    );
  }
  const ix = entry.interaction;
  return (
    <button className="timeline-item timeline-item--interaction" onClick={() => onEditInteraction(ix)}>
      <span className="timeline-item-date">{formatShortDate(entry.date)}</span>
      <span className="timeline-item-body">
        <strong>🤝 Contact logged</strong>
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
