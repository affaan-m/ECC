import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore, useActions } from '../data/store.jsx';
import EditorSheet from '../components/EditorSheet.jsx';
import Modal from '../components/Modal.jsx';
import Checkbox from '../components/Checkbox.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { todayISO, toISODate, addDays, formatShortDate, formatTime, expandEventOnDay } from '../data/helpers.js';
import { contactInsights } from '../data/contactInsights.js';
import { useToast } from '../data/toast.jsx';
import { confirmTick, selectTick, warnTick } from '../data/haptics.js';
import Icon from '../components/Icon.jsx';

const WINDOW_DAYS = 180; // how far past/future the feed reaches

export default function ContactTimelinePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useStore();
  const actions = useActions();
  const showToast = useToast();
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

  // Multi-select, for tidying up a stretch of history in one go: pick
  // several entries and shift or delete them together.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set()); // entry keys
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [moveToDate, setMoveToDate] = useState('');
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

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

  const entryByKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);
  const selectedEntries = () => [...selected].map((k) => entryByKey.get(k)).filter(Boolean);

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const toggleSelected = (key) => {
    selectTick();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const beginSelect = (key) => {
    setSelectMode(true);
    setSelected(new Set([key]));
    selectTick();
  };

  // Every selected entry, each master event touched exactly once.
  //
  // The once-per-master part is the whole reason this is written out rather
  // than dispatching inside the loop: two occurrences of the same weekly
  // event are two entries but one stored object, and reading that object
  // back out of `state` for the second one would hand you the version from
  // before the first was applied — so the second write would drop the
  // first's override. Edits are staged on a working copy and dispatched once
  // each, at the end.
  const stageMasters = (picked) => {
    const working = new Map();
    const original = new Map();
    const get = (eventId) => {
      if (!working.has(eventId)) {
        const master = state.events.find((e) => e.id === eventId);
        if (!master) return null;
        // `overrides` and `skipDates` are spelled out even when the event has
        // neither, because UPDATE_EVENT merges rather than replaces: a
        // snapshot that simply lacks the key can't undo one being added, and
        // the restore would silently leave it behind.
        original.set(eventId, {
          ...master,
          overrides: master.overrides || {},
          skipDates: master.skipDates || [],
        });
        working.set(eventId, { ...master });
      }
      return working.get(eventId);
    };
    return { get, working, original, picked };
  };

  const moveSelected = (dayOffset) => {
    const picked = selectedEntries();
    if (!dayOffset || picked.length === 0) return;
    const { get, working, original } = stageMasters(picked);
    const beforeInteractions = [];

    for (const entry of picked) {
      const newDate = toISODate(addDays(entry.date, dayOffset));
      if (entry.type === 'interaction') {
        beforeInteractions.push(entry.interaction);
        actions.updateInteraction({ ...entry.interaction, date: newDate });
        continue;
      }
      const { occ } = entry;
      const master = get(occ.id);
      if (!master) continue;
      if ((master.repeat || 'none') === 'none') {
        master.date = newDate;
      } else {
        // A single occurrence of a series moves as an override, leaving the
        // rest of the series where it is — the same thing dragging one block
        // in the Planner does.
        master.overrides = {
          ...(master.overrides || {}),
          [occ.recDate]: {
            title: occ.title,
            start: occ.start,
            end: occ.end,
            contactId: occ.contactId,
            location: occ.location,
            notes: occ.notes,
            date: newDate,
          },
        };
      }
    }
    for (const master of working.values()) actions.updateEvent(master);

    confirmTick();
    exitSelect();
    const n = picked.length;
    const dir = dayOffset > 0 ? '+' : '−';
    const mag = Math.abs(dayOffset);
    showToast(
      `Moved ${dir}${mag} day${mag === 1 ? '' : 's'} · ${n} item${n === 1 ? '' : 's'}`,
      'Undo',
      () => {
        // Restoring the snapshot rather than moving back by −dayOffset: an
        // override may not have existed before the move, and re-applying the
        // inverse would leave the series carrying one that says nothing.
        for (const master of original.values()) actions.updateEvent(master);
        for (const ix of beforeInteractions) actions.updateInteraction(ix);
      }
    );
  };

  // Move so the earliest selected entry lands on `date`, everything else
  // shifting with it. Collapsing them all onto one day would destroy the
  // spacing that made them worth selecting together.
  const moveSelectedToDate = (date) => {
    const picked = selectedEntries();
    if (!date || picked.length === 0) return;
    const earliest = picked.map((e) => e.date).sort()[0];
    const offset = Math.round((new Date(`${date}T00:00`) - new Date(`${earliest}T00:00`)) / 86400000);
    if (offset === 0) {
      exitSelect();
      return;
    }
    moveSelected(offset);
  };

  const deleteSelected = () => {
    const picked = selectedEntries();
    if (picked.length === 0) return;
    const { get, working, original } = stageMasters(picked);
    const removedEvents = [];
    const removedInteractions = [];

    for (const entry of picked) {
      if (entry.type === 'interaction') {
        removedInteractions.push(entry.interaction);
        actions.deleteInteraction(entry.interaction.id);
        continue;
      }
      const { occ } = entry;
      const master = get(occ.id);
      if (!master) continue;
      if ((master.repeat || 'none') === 'none') {
        removedEvents.push(original.get(occ.id));
        working.delete(occ.id);
        actions.deleteEvent(occ.id);
      } else {
        // One occurrence of a series is skipped, not deleted — removing the
        // master would take every other occurrence with it.
        const overrides = { ...(master.overrides || {}) };
        delete overrides[occ.recDate];
        master.overrides = overrides;
        master.skipDates = [...(master.skipDates || []), occ.recDate];
      }
    }
    for (const master of working.values()) actions.updateEvent(master);

    warnTick();
    exitSelect();
    const n = picked.length;
    showToast(`Deleted ${n} item${n === 1 ? '' : 's'}`, 'Undo', () => {
      for (const ev of removedEvents) actions.addEvent(ev);
      for (const master of original.values()) {
        if (!removedEvents.some((e) => e.id === master.id)) actions.updateEvent(master);
      }
      for (const ix of removedInteractions) actions.addInteraction(ix);
    });
  };

  // Editing an event means the event editor, which lives on the Planner —
  // there is exactly one of those and a second copy here would drift from it
  // within a release. `returnTo` brings you straight back here when the
  // sheet closes, so it reads as editing in place.
  const openEvent = (entry) => {
    navigate('/planner', {
      state: {
        openEventId: entry.occ.id,
        openEventDate: entry.date,
        returnTo: `/contacts/${id}/timeline`,
      },
    });
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
          {selectMode ? (
            <>
              <button className="back-btn" onClick={exitSelect}>
                Cancel
              </button>
              <span className="muted small">
                {selected.size} selected
              </span>
            </>
          ) : (
            <>
              <button className="back-btn" onClick={() => navigate(`/contacts/${id}`)}>
                ‹ {contact.name}
              </button>
              <div className="timeline-head-actions">
                {entries.length > 0 && (
                  <button className="timeline-select-btn" onClick={() => setSelectMode(true)}>
                    Select
                  </button>
                )}
                <button
                  className="icon-btn"
                  onClick={jumpToToday}
                  aria-label="Jump to today"
                  title="Jump to today"
                >
                  <TimelineTodayIcon />
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* The person, tappable — you're looking straight at them and their
          details are one back-tap plus one Edit away, which is two taps too
          many for "actually, her number changed".
          The pencil sits beside the name rather than in the top-right
          corner: up there it stacked directly under the header's own button
          and the two read as a pair of controls, when only one of them is a
          button at all. */}
      <button
        className="detail-hero detail-hero--compact timeline-hero"
        onClick={() => navigate(`/contacts/${id}`, { state: { edit: true } })}
      >
        <Avatar name={contact.name} photo={contact.photo} color={status?.color} size="md" />
        <h1>
          {contact.name}'s timeline
          <span className="timeline-hero-edit">
            <Icon name="pencil" size={15} />
          </span>
        </h1>
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

        {/* Two bands, split by the Today line: what's still to come, and
            what already happened. They used to look identical, so the line
            was the only thing telling them apart and you had to read a date
            to know which side of now you were on. Past entries are receded
            now — same information, visibly settled. */}
        {futureAll.length > 0 && <div className="timeline-band">Upcoming</div>}
        {future.map((entry) => (
          <TimelineEntry
            key={entry.key}
            entry={entry}
            selectMode={selectMode}
            selected={selected.has(entry.key)}
            onToggle={() => toggleSelected(entry.key)}
            onLongPress={() => beginSelect(entry.key)}
            onEditInteraction={(ix) => setEditingInteraction({ ...ix })}
            onEditEvent={() => openEvent(entry)}
          />
        ))}
        {entries.length > 0 && futureAll.length === 0 && (
          <p className="timeline-band-empty muted small">Nothing coming up.</p>
        )}

        {entries.length > 0 && (
          <div ref={anchorRef} className="timeline-today-marker">
            <span>Today</span>
          </div>
        )}

        {past.map((entry) => (
          <TimelineEntry
            key={entry.key}
            entry={entry}
            past
            selectMode={selectMode}
            selected={selected.has(entry.key)}
            onToggle={() => toggleSelected(entry.key)}
            onLongPress={() => beginSelect(entry.key)}
            onEditInteraction={(ix) => setEditingInteraction({ ...ix })}
            onEditEvent={() => openEvent(entry)}
          />
        ))}
        {entries.length > 0 && pastAll.length === 0 && (
          <p className="timeline-band-empty muted small">Nothing logged yet.</p>
        )}

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

      {!selectMode && (
        <button className="fab" onClick={() => setAddMenuOpen(true)} aria-label="Add to timeline">
          +
        </button>
      )}

      {selectMode && selected.size > 0 && (
        <div className="select-bar select-bar--wrap">
          <span>{selected.size} selected</span>
          <div className="select-bar-actions">
            <button className="btn btn-ghost btn-sm" data-haptic="none" onClick={() => moveSelected(-1)}>
              −1 day
            </button>
            <button className="btn btn-ghost btn-sm" data-haptic="none" onClick={() => moveSelected(1)}>
              +1 day
            </button>
            <button className="btn btn-ghost btn-sm" data-haptic="none" onClick={() => moveSelected(7)}>
              +1 week
            </button>
            <button
              className="btn btn-ghost btn-sm"
              data-haptic="none"
              onClick={() => {
                setMoveToDate(selectedEntries().map((e) => e.date).sort()[0] || today);
                setDatePickerOpen(true);
              }}
            >
              <Icon name="calendar" size={15} /> Date
            </button>
            <button
              className="btn btn-ghost btn-sm danger-text"
              data-haptic="none"
              onClick={() => setConfirmBulkDelete(true)}
            >
              <Icon name="trash" size={15} /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Move to a chosen day. The picker moves the earliest of the
          selection onto that date and carries the rest along by the same
          amount, so a run of visits keeps its shape. */}
      <Modal
        open={datePickerOpen}
        title="Move to…"
        onClose={() => setDatePickerOpen(false)}
        footer={
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setDatePickerOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={!moveToDate}
              onClick={() => {
                setDatePickerOpen(false);
                moveSelectedToDate(moveToDate);
              }}
            >
              Move
            </button>
          </div>
        }
      >
        <div className="form">
          <label className="field">
            <span>{selected.size > 1 ? 'Move the earliest one to' : 'Move to'}</span>
            <input type="date" value={moveToDate} onChange={(e) => setMoveToDate(e.target.value)} />
          </label>
          {selected.size > 1 && (
            <p className="muted small">
              The other {selected.size - 1} shift by the same number of days.
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={confirmBulkDelete}
        title={`Delete ${selected.size} item${selected.size === 1 ? '' : 's'}?`}
        onClose={() => setConfirmBulkDelete(false)}
        footer={
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmBulkDelete(false)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                setConfirmBulkDelete(false);
                deleteSelected();
              }}
            >
              Delete
            </button>
          </div>
        }
      >
        <p>
          You'll have a moment to undo this.
          {selectedEntries().some((e) => e.type === 'event' && (e.occ.repeat || 'none') !== 'none') &&
            ' Repeating events lose only the occurrence you picked — the rest of the series stays.'}
        </p>
      </Modal>

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

// How long a press has to be held before it means "select this" rather than
// "open this".
const LONG_PRESS_MS = 420;
// …and how far the finger may wander in that time before it's a scroll.
const LONG_PRESS_SLOP_PX = 10;

function TimelineEntry({
  entry,
  past = false,
  selectMode = false,
  selected = false,
  onToggle,
  onLongPress,
  onEditInteraction,
  onEditEvent,
}) {
  const timer = useRef(null);
  const origin = useRef(null);
  const fired = useRef(false);

  // Press-and-hold to start selecting, the same way the Planner's blocks
  // work. Cancelled by any real movement, so holding still while a scroll
  // decelerates doesn't select something.
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };
  const onPointerDown = (e) => {
    if (selectMode) return;
    fired.current = false;
    origin.current = { x: e.clientX, y: e.clientY };
    timer.current = setTimeout(() => {
      fired.current = true;
      onLongPress?.();
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e) => {
    if (!origin.current) return;
    const dx = Math.abs(e.clientX - origin.current.x);
    const dy = Math.abs(e.clientY - origin.current.y);
    if (dx > LONG_PRESS_SLOP_PX || dy > LONG_PRESS_SLOP_PX) cancel();
  };
  const onClick = () => {
    // Checked before the select-mode branch, not after: a hold that starts
    // select mode is followed by a click on release, and by then selectMode
    // is true — so the release would toggle straight back off the row the
    // hold had just picked, and holding a row appeared to do nothing at all.
    if (fired.current) {
      fired.current = false;
      return;
    }
    if (selectMode) return onToggle?.();
    if (entry.type === 'event') onEditEvent?.();
    else onEditInteraction?.(entry.interaction);
  };

  const cls = [
    'timeline-item',
    entry.type === 'event' ? 'timeline-item--event' : 'timeline-item--interaction',
    past ? 'timeline-item--past' : '',
    selected ? 'timeline-item--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const press = {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClick,
    // The delegated app-wide haptics can't tell a tap from a hold here, and
    // both paths already tick for themselves.
    'data-haptic': 'none',
  };

  const check = selectMode ? (
    <span className={`select-dot${selected ? ' select-dot--on' : ''}`} aria-hidden="true" />
  ) : null;

  if (entry.type === 'event') {
    const { occ } = entry;
    return (
      <button className={cls} {...press} aria-pressed={selectMode ? selected : undefined}>
        {check}
        <span className="timeline-item-date">
          {formatShortDate(entry.date)}
          <small>{formatTime(occ.start)}</small>
        </span>
        <span className="timeline-item-body">
          <strong>{occ.title || 'Untitled event'}</strong>
          {occ.repeat && occ.repeat !== 'none' && <span className="repeat-glyph"> <Icon name="repeat" size={13} /></span>}
          {occ.location && <span className="timeline-item-text">{occ.location}</span>}
        </span>
        {!selectMode && <Icon name="pencil" size={14} className="timeline-item-edit" />}
      </button>
    );
  }

  const ix = entry.interaction;
  return (
    <button className={cls} {...press} aria-pressed={selectMode ? selected : undefined}>
      {check}
      <span className="timeline-item-date">{formatShortDate(entry.date)}</span>
      <span className="timeline-item-body">
        <strong><Icon name="personCheck" size={15} /> Contact logged</strong>
        {ix.text && <span className="timeline-item-text">{ix.text}</span>}
      </span>
      {!selectMode && <Icon name="pencil" size={14} className="timeline-item-edit" />}
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
