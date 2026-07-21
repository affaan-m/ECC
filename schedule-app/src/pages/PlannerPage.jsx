import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore, useActions } from '../data/store.jsx';
import Modal from '../components/Modal.jsx';
import { Brand } from '../components/Logo.jsx';
import {
  requestNotificationPermission,
  notificationsSupported,
} from '../data/notifications.js';
import {
  toISODate,
  todayISO,
  fromISODate,
  addDays,
  startOfWeek,
  weekDays,
  formatDayLabel,
  formatWeekRange,
  weekdayShort,
  formatTime,
  timeToMinutes,
  minutesToTime,
  isToday,
  expandEventOnDay,
  repeatLabel,
  REPEAT_OPTIONS,
} from '../data/helpers.js';

const DAY_START = 6;
const DAY_END = 23;
const PX_PER_HOUR = 56;
const PX_PER_MIN = PX_PER_HOUR / 60;
const REMINDER_OPTIONS = [
  { v: 0, l: 'No reminder' },
  { v: 5, l: '5 min before' },
  { v: 10, l: '10 min before' },
  { v: 15, l: '15 min before' },
  { v: 30, l: '30 min before' },
  { v: 60, l: '1 hour before' },
];

function occurrencesFor(events, iso) {
  return events
    .flatMap((e) => expandEventOnDay(e, iso))
    .map((o) => ({ ...o, s: timeToMinutes(o.start), e2: timeToMinutes(o.end) }));
}

function setMembership(arr, value, present) {
  const set = new Set(arr || []);
  if (present) set.add(value);
  else set.delete(value);
  return [...set];
}

export default function PlannerPage() {
  const { state } = useStore();
  const actions = useActions();
  const location = useLocation();
  const [mode, setMode] = useState('day');
  const [cursor, setCursor] = useState(() => todayISO());
  const [editing, setEditing] = useState(null);

  const openNew = (date, start = '09:00', extra = {}) =>
    setEditing({
      title: '',
      date,
      start,
      end: minutesToTime(Math.min(DAY_END * 60, timeToMinutes(start) + 60)),
      contactId: '',
      location: '',
      notes: '',
      done: false,
      repeat: 'none',
      repeatUntil: '',
      typeId: state.eventTypes?.[0]?.id || '',
      color: '',
      reminder: 0,
      ...extra,
    });

  // Opened from a person's page ("+ add event for this contact").
  useEffect(() => {
    const cid = location.state?.newEventContact;
    if (cid) {
      openNew(todayISO(), '09:00', { contactId: cid });
      window.history.replaceState({}, '');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveEvent = (pl) => {
    if (pl.isNew || !pl.id) {
      const recurring = pl.repeat && pl.repeat !== 'none';
      actions.addEvent({
        ...pl.fields,
        date: pl.date,
        repeat: pl.repeat || 'none',
        repeatUntil: recurring ? pl.repeatUntil || '' : '',
        done: recurring ? false : !!pl.done,
        doneDates: recurring && pl.done ? [pl.date] : [],
        skipDates: [],
        overrides: {},
      });
      setEditing(null);
      return;
    }
    const master = state.events.find((e) => e.id === pl.id);
    if (!master) return setEditing(null);
    const repeat = master.repeat || 'none';
    if (repeat === 'none') {
      actions.updateEvent({ ...master, ...pl.fields, date: pl.date, done: !!pl.done });
    } else if (pl.scope === 'all') {
      const recurring = pl.repeat && pl.repeat !== 'none';
      const next = {
        ...master,
        ...pl.fields,
        date: pl.date,
        repeat: pl.repeat,
        repeatUntil: recurring ? pl.repeatUntil || '' : '',
      };
      if (!recurring) {
        next.overrides = {};
        next.doneDates = [];
        next.skipDates = [];
        next.done = !!pl.done;
      } else {
        next.done = false;
        next.doneDates = setMembership(master.doneDates, pl.recDate, pl.done);
      }
      actions.updateEvent(next);
    } else {
      const overrides = { ...(master.overrides || {}) };
      const ov = { ...pl.fields };
      if (pl.date && pl.date !== pl.recDate) ov.date = pl.date;
      overrides[pl.recDate] = ov;
      actions.updateEvent({
        ...master,
        overrides,
        doneDates: setMembership(master.doneDates, pl.recDate, pl.done),
      });
    }
    setEditing(null);
  };

  const skipOccurrence = (id, recDate) => {
    const ev = state.events.find((e) => e.id === id);
    if (ev) {
      const overrides = { ...(ev.overrides || {}) };
      delete overrides[recDate];
      actions.updateEvent({ ...ev, skipDates: [...(ev.skipDates || []), recDate], overrides });
    }
    setEditing(null);
  };

  // Drag-to-reschedule: shift an occurrence by whole minutes.
  const moveOccurrence = (occ, deltaMin) => {
    const master = state.events.find((e) => e.id === occ.id);
    if (!master) return;
    const dur = timeToMinutes(occ.end) - timeToMinutes(occ.start);
    let ns = timeToMinutes(occ.start) + deltaMin;
    ns = Math.max(DAY_START * 60, Math.min(DAY_END * 60 - dur, ns));
    const start = minutesToTime(ns);
    const end = minutesToTime(ns + dur);
    if ((master.repeat || 'none') === 'none') {
      actions.updateEvent({ ...master, start, end });
    } else {
      const overrides = { ...(master.overrides || {}) };
      overrides[occ.recDate] = {
        title: occ.title,
        start,
        end,
        contactId: occ.contactId,
        location: occ.location,
        notes: occ.notes,
        ...(occ.occDate !== occ.recDate ? { date: occ.occDate } : {}),
      };
      actions.updateEvent({ ...master, overrides });
    }
  };

  const step = (n) => setCursor(toISODate(addDays(cursor, mode === 'day' ? n : n * 7)));
  const weekStart = startOfWeek(fromISODate(cursor));

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-row">
          <Brand>Planner</Brand>
          <div className="seg">
            <button className={`seg-btn${mode === 'day' ? ' seg-btn--on' : ''}`} onClick={() => setMode('day')}>
              Day
            </button>
            <button className={`seg-btn${mode === 'week' ? ' seg-btn--on' : ''}`} onClick={() => setMode('week')}>
              Week
            </button>
          </div>
        </div>
        <div className="week-nav">
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous">
            <Chevron dir="left" />
          </button>
          <button className="week-label" onClick={() => setCursor(todayISO())} title="Jump to today">
            {mode === 'day' ? formatDayLabel(cursor) : formatWeekRange(weekStart)}
            <span className="week-sub">{mode === 'day' ? (isToday(cursor) ? 'Today' : '') : 'Week'}</span>
          </button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Next">
            <Chevron dir="right" />
          </button>
        </div>
      </header>

      {mode === 'day' ? (
        <DayView
          date={cursor}
          events={state.events}
          contacts={state.contacts}
          eventTypes={state.eventTypes || []}
          onAddAt={(start) => openNew(cursor, start)}
          onOpen={setEditing}
          onMove={moveOccurrence}
        />
      ) : (
        <WeekView
          weekStart={weekStart}
          events={state.events}
          eventTypes={state.eventTypes || []}
          onOpenDay={(iso) => {
            setCursor(iso);
            setMode('day');
          }}
          onOpen={setEditing}
          onAdd={(iso) => openNew(iso)}
        />
      )}

      <button className="fab" onClick={() => openNew(cursor)} aria-label="New event">
        +
      </button>

      <EventModal
        editing={editing}
        contacts={state.contacts}
        eventTypes={state.eventTypes || []}
        onClose={() => setEditing(null)}
        onSave={saveEvent}
        onDelete={(id) => {
          actions.deleteEvent(id);
          setEditing(null);
        }}
        onSkipOccurrence={skipOccurrence}
        setSettings={actions.setSettings}
      />
    </div>
  );
}

// --- Day timeline (with drag-to-reschedule) --------------------------------

function DayView({ date, events, contacts, eventTypes, onAddAt, onOpen, onMove }) {
  const bodyRef = useRef(null);
  const dragRef = useRef(null); // { occ, startY, moved }
  const [dragKey, setDragKey] = useState(null);
  const [dragDy, setDragDy] = useState(0);

  const dayEvents = useMemo(() => occurrencesFor(events, date).filter((e) => e.e2 > e.s), [events, date]);
  const laid = useMemo(() => layout(dayEvents), [dayEvents]);
  const contactName = (id) => contacts.find((c) => c.id === id)?.name;
  const typeColor = (id) => eventTypes.find((t) => t.id === id)?.color;

  const hours = [];
  for (let h = DAY_START; h <= DAY_END; h++) hours.push(h);

  const handleBgClick = (e) => {
    const rect = bodyRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let mins = DAY_START * 60 + y / PX_PER_MIN;
    mins = Math.round(mins / 30) * 30;
    onAddAt(minutesToTime(Math.max(DAY_START * 60, Math.min(DAY_END * 60 - 30, mins))));
  };

  const onDown = (e, occ) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { occ, startY: e.clientY, moved: false };
  };
  const onMoveP = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) > 6) {
      d.moved = true;
      setDragKey(`${d.occ.id}:${d.occ.recDate}`);
    }
    if (d.moved) setDragDy(dy);
  };
  const onUp = (e, occ) => {
    const d = dragRef.current;
    dragRef.current = null;
    const dy = dragDy;
    setDragKey(null);
    setDragDy(0);
    if (!d) return;
    if (!d.moved) {
      onOpen(occ);
      return;
    }
    const deltaMin = Math.round(dy / PX_PER_MIN / 15) * 15;
    if (deltaMin !== 0) onMove(occ, deltaMin);
  };

  return (
    <div className="timeline">
      <div
        className="timeline-body"
        ref={bodyRef}
        style={{ height: (DAY_END - DAY_START + 1) * PX_PER_HOUR }}
        onClick={handleBgClick}
      >
        {hours.map((h) => (
          <div className="hour-row" key={h} style={{ height: PX_PER_HOUR }}>
            <span className="hour-label">{formatTime(`${String(h).padStart(2, '0')}:00`)}</span>
            <div className="hour-line" />
          </div>
        ))}

        <div className="event-layer">
          {laid.map((ev) => {
            const top = (ev.s - DAY_START * 60) * PX_PER_MIN;
            const height = Math.max(24, (ev.e2 - ev.s) * PX_PER_MIN - 3);
            const short = ev.e2 - ev.s < 55;
            const who = contactName(ev.contactId);
            const recurring = ev.repeat && ev.repeat !== 'none';
            const color = ev.color || typeColor(ev.typeId);
            const k = `${ev.id}:${ev.recDate}`;
            const isDragging = dragKey === k;
            return (
              <button
                key={k}
                className={`event-block${ev.done ? ' event-block--done' : ''}${short ? ' event-block--short' : ''}${isDragging ? ' event-block--dragging' : ''}`}
                style={{
                  top,
                  height,
                  left: `${(ev.col / ev.cols) * 100}%`,
                  width: `calc(${100 / ev.cols}% - 4px)`,
                  '--ev': color || 'var(--accent)',
                  transform: isDragging ? `translateY(${dragDy}px)` : undefined,
                }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => onDown(e, ev)}
                onPointerMove={onMoveP}
                onPointerUp={(e) => onUp(e, ev)}
                onPointerCancel={(e) => onUp(e, ev)}
              >
                {short ? (
                  <span className="event-title">
                    <span className="event-time-inline">
                      {isDragging ? formatTime(minutesToTime(clampStart(ev, dragDy))) : formatTime(ev.start)}
                    </span>{' '}
                    {ev.title || 'Untitled'}
                    {recurring && <span className="repeat-glyph"> {ev.isException ? '✎' : '↻'}</span>}
                  </span>
                ) : (
                  <>
                    <span className="event-time">
                      {isDragging ? formatTime(minutesToTime(clampStart(ev, dragDy))) : formatTime(ev.start)}
                      {recurring && <span className="repeat-glyph"> {ev.isException ? '✎' : '↻'}</span>}
                      {ev.reminder > 0 && <span className="repeat-glyph"> 🔔</span>}
                    </span>
                    <span className="event-title">{ev.title || 'Untitled'}</span>
                    {who && <span className="event-who">{who}</span>}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {dayEvents.length === 0 && (
        <p className="timeline-hint muted">Tap anywhere to add. Drag a block to reschedule.</p>
      )}
    </div>
  );
}

function clampStart(ev, dy) {
  const delta = Math.round(dy / PX_PER_MIN / 15) * 15;
  const dur = ev.e2 - ev.s;
  return Math.max(DAY_START * 60, Math.min(DAY_END * 60 - dur, ev.s + delta));
}

// --- Week agenda -----------------------------------------------------------

function WeekView({ weekStart, events, eventTypes, onOpenDay, onOpen, onAdd }) {
  const days = weekDays(weekStart);
  const typeColor = (id) => eventTypes.find((t) => t.id === id)?.color;
  return (
    <div className="agenda">
      {days.map((d) => {
        const iso = toISODate(d);
        const dayEvents = occurrencesFor(events, iso).sort((a, b) => a.s - b.s);
        return (
          <section key={iso} className={`agenda-day${isToday(iso) ? ' agenda-day--today' : ''}`}>
            <div className="agenda-date">
              <button className="agenda-date-btn" onClick={() => onOpenDay(iso)}>
                <span className="agenda-dow">{weekdayShort(d)}</span>
                <span className="agenda-num">{d.getDate()}</span>
              </button>
            </div>
            <div className="agenda-events">
              {dayEvents.length === 0 ? (
                <button className="agenda-empty" onClick={() => onAdd(iso)}>
                  + Add
                </button>
              ) : (
                dayEvents.map((ev) => {
                  const recurring = ev.repeat && ev.repeat !== 'none';
                  return (
                    <button
                      key={`${ev.id}:${ev.recDate}`}
                      className={`agenda-chip${ev.done ? ' agenda-chip--done' : ''}`}
                      style={{ '--ev': ev.color || typeColor(ev.typeId) || 'var(--accent)' }}
                      onClick={() => onOpen(ev)}
                    >
                      <span className="chip-time">{formatTime(ev.start)}</span>
                      <span className="chip-title">{ev.title || 'Untitled'}</span>
                      {ev.reminder > 0 && <span className="repeat-glyph">🔔</span>}
                      {recurring && <span className="repeat-glyph">{ev.isException ? '✎' : '↻'}</span>}
                    </button>
                  );
                })
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// --- Event editor ----------------------------------------------------------

function EventModal({ editing, contacts, eventTypes, onClose, onSave, onDelete, onSkipOccurrence, setSettings }) {
  const [draft, setDraft] = useState(null);
  const recurringMaster = !!editing?.id && !!editing?.repeat && editing.repeat !== 'none';

  const key = editing ? `${editing.id || 'new'}|${editing.recDate || editing.date}|${editing.start}` : null;
  if (editing && (!draft || draft._key !== key)) {
    setDraft({
      _key: key,
      id: editing.id,
      scope: recurringMaster ? 'this' : 'all',
      title: editing.title,
      start: editing.start,
      end: editing.end,
      contactId: editing.contactId || '',
      location: editing.location || '',
      notes: editing.notes || '',
      date: recurringMaster ? editing.occDate || editing.date : editing.date,
      done: !!editing.done,
      repeat: editing.repeat || 'none',
      repeatUntil: editing.repeatUntil || '',
      typeId: editing.typeId || '',
      color: editing.color || '',
      reminder: Number(editing.reminder) || 0,
      recDate: editing.recDate || editing.date,
      occDate: editing.occDate || editing.date,
      masterDate: editing.date,
      base: editing.base || null,
    });
  }
  if (!editing && draft) setDraft(null);

  const applyScope = (s) => {
    if (!draft || s === draft.scope) return;
    if (s === 'all') {
      const b = draft.base || {};
      setDraft({
        ...draft,
        scope: 'all',
        title: b.title ?? draft.title,
        start: b.start ?? draft.start,
        end: b.end ?? draft.end,
        contactId: b.contactId ?? draft.contactId,
        location: b.location ?? draft.location,
        notes: b.notes ?? draft.notes,
        date: draft.masterDate,
        repeat: editing.repeat || 'none',
        repeatUntil: editing.repeatUntil || '',
      });
    } else {
      setDraft({
        ...draft,
        scope: 'this',
        title: editing.title,
        start: editing.start,
        end: editing.end,
        contactId: editing.contactId || '',
        location: editing.location || '',
        notes: editing.notes || '',
        date: draft.occDate,
      });
    }
  };

  const thisScope = draft?.scope === 'this';
  const recurring = (draft?.repeat || 'none') !== 'none';

  const setReminder = async (mins) => {
    setDraft({ ...draft, reminder: mins });
    if (mins > 0) {
      await requestNotificationPermission();
      setSettings({ notifications: true });
    }
  };

  const save = () => {
    if (!draft) return;
    let end = draft.end;
    if (timeToMinutes(end) <= timeToMinutes(draft.start)) end = minutesToTime(timeToMinutes(draft.start) + 30);
    onSave({
      id: draft.id,
      isNew: !draft.id,
      scope: draft.scope,
      recDate: draft.recDate,
      date: draft.date,
      repeat: draft.repeat,
      repeatUntil: draft.repeatUntil,
      done: draft.done,
      fields: {
        title: draft.title.trim() || 'Untitled',
        start: draft.start,
        end,
        contactId: draft.contactId || '',
        location: draft.location,
        notes: draft.notes,
        typeId: draft.typeId,
        color: draft.color,
        reminder: draft.reminder,
      },
    });
  };

  return (
    <Modal
      open={!!editing}
      tall
      title={editing?.id ? 'Edit event' : 'New event'}
      onClose={onClose}
      footer={
        <div className="modal-actions">
          {editing?.id && (
            <div className="del-group">
              {recurringMaster ? (
                <>
                  <button className="btn btn-danger-ghost btn-sm" onClick={() => onSkipOccurrence(editing.id, draft.recDate)}>
                    Delete this day
                  </button>
                  <button className="btn btn-danger-ghost btn-sm" onClick={() => onDelete(editing.id)}>
                    Delete series
                  </button>
                </>
              ) : (
                <button className="btn btn-danger-ghost" onClick={() => onDelete(editing.id)}>
                  Delete
                </button>
              )}
            </div>
          )}
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </div>
      }
    >
      {draft && (
        <div className="form">
          {recurringMaster && (
            <div className="seg seg--full">
              <button className={`seg-btn${thisScope ? ' seg-btn--on' : ''}`} onClick={() => applyScope('this')}>
                This event
              </button>
              <button className={`seg-btn${!thisScope ? ' seg-btn--on' : ''}`} onClick={() => applyScope('all')}>
                All events
              </button>
            </div>
          )}

          <label className="field">
            <span>Title</span>
            <input
              autoFocus
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="e.g. Coffee with Sam"
            />
          </label>

          {/* Event type */}
          {eventTypes.length > 0 && (
            <div className="field">
              <span>Type</span>
              <div className="chips">
                <button
                  className={`chip${!draft.typeId ? ' chip--on' : ''}`}
                  onClick={() => setDraft({ ...draft, typeId: '' })}
                >
                  None
                </button>
                {eventTypes.map((t) => (
                  <button
                    key={t.id}
                    className={`chip${draft.typeId === t.id ? ' chip--on' : ''}`}
                    style={
                      draft.typeId === t.id
                        ? { background: t.color, borderColor: t.color, color: '#fff' }
                        : { borderColor: t.color, color: t.color }
                    }
                    onClick={() => setDraft({ ...draft, typeId: t.id })}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Individual color override */}
          <div className="field">
            <span>Block color</span>
            <div className="color-grid">
              <button
                className={`color-dot color-dot--clear${!draft.color ? ' color-dot--on' : ''}`}
                onClick={() => setDraft({ ...draft, color: '' })}
                title="Use type color"
              >
                ✕
              </button>
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  className={`color-dot${draft.color === c ? ' color-dot--on' : ''}`}
                  style={{ background: c }}
                  onClick={() => setDraft({ ...draft, color: c })}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>

          <label className="field">
            <span>{recurring && !thisScope ? 'Starts' : 'Date'}</span>
            <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Start</span>
              <input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
            </label>
            <label className="field">
              <span>End</span>
              <input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
            </label>
          </div>

          {!thisScope && (
            <label className="field">
              <span>Repeat</span>
              <select value={draft.repeat} onChange={(e) => setDraft({ ...draft, repeat: e.target.value })}>
                {REPEAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!thisScope && recurring && (
            <label className="field">
              <span>Ends (optional)</span>
              <input
                type="date"
                value={draft.repeatUntil || ''}
                min={draft.date}
                onChange={(e) => setDraft({ ...draft, repeatUntil: e.target.value })}
              />
              <span className="muted small">
                {repeatLabel(draft.repeat)}
                {draft.repeatUntil ? '' : ' · no end date'}
              </span>
            </label>
          )}
          {thisScope && (
            <p className="muted small scope-note">
              Editing only this occurrence{draft.date !== draft.recDate ? ' (moved from its usual day)' : ''}.
            </p>
          )}

          {/* Reminder */}
          <label className="field">
            <span>Reminder</span>
            <select value={draft.reminder} onChange={(e) => setReminder(Number(e.target.value))}>
              {REMINDER_OPTIONS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>
            {draft.reminder > 0 && !notificationsSupported() && (
              <span className="muted small">This browser can't show notifications.</span>
            )}
          </label>

          <label className="field">
            <span>With</span>
            <select value={draft.contactId || ''} onChange={(e) => setDraft({ ...draft, contactId: e.target.value })}>
              <option value="">No one linked</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Location</span>
            <input
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              placeholder="Optional"
            />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea
              rows="2"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Optional"
            />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={!!draft.done} onChange={(e) => setDraft({ ...draft, done: e.target.checked })} />
            <span>{recurringMaster ? 'Mark this day done' : 'Mark as done'}</span>
          </label>
        </div>
      )}
    </Modal>
  );
}

const COLOR_SWATCHES = ['#1f5f8b', '#8a5cd1', '#2e9e6b', '#e08a1e', '#d1495b', '#3a9188', '#c2547a', '#5b7fb0'];

// --- Layout helper ---------------------------------------------------------

function layout(events) {
  const sorted = [...events].sort((a, b) => a.s - b.s || a.e2 - b.e2);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const ev of cluster) {
      let placed = false;
      for (let i = 0; i < cols.length; i++) {
        if (cols[i][cols[i].length - 1].e2 <= ev.s) {
          cols[i].push(ev);
          ev.col = i;
          placed = true;
          break;
        }
      }
      if (!placed) {
        ev.col = cols.length;
        cols.push([ev]);
      }
    }
    for (const ev of cluster) {
      ev.cols = cols.length;
      out.push(ev);
    }
    cluster = [];
  };
  for (const ev of sorted) {
    if (cluster.length && ev.s >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.e2);
  }
  if (cluster.length) flush();
  return out;
}

function Chevron({ dir }) {
  const d = dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6';
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
