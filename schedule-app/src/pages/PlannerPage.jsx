import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore, useActions } from '../data/store.jsx';
import EditorSheet from '../components/EditorSheet.jsx';
import Select from '../components/Select.jsx';
import MiniMapPicker from '../components/MiniMapPicker.jsx';
import { Brand } from '../components/Logo.jsx';
import { confirmTick, selectTick } from '../data/haptics.js';
import {
  requestNotificationPermission,
  notificationsSupported,
} from '../data/notifications.js';
import {
  toISODate,
  todayISO,
  fromISODate,
  addDays,
  addMonths,
  startOfWeek,
  startOfMonth,
  weekDays,
  monthGrid,
  formatDayLabel,
  formatWeekRange,
  formatMonthLabel,
  weekdayShort,
  formatShortDate,
  formatTime,
  timeToMinutes,
  minutesToTime,
  isToday,
  expandEventOnDay,
  repeatLabel,
  REPEAT_OPTIONS,
  WEEKDAY_LETTERS,
} from '../data/helpers.js';

const DAY_START = 6;
const DAY_END = 23;
const PX_PER_HOUR = 56;
const PX_PER_MIN = PX_PER_HOUR / 60;
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 9;
const REMINDER_OPTIONS = [
  { v: 0, l: 'No reminder' },
  { v: 5, l: '5 min before' },
  { v: 10, l: '10 min before' },
  { v: 15, l: '15 min before' },
  { v: 30, l: '30 min before' },
  { v: 60, l: '1 hour before' },
];
const COLOR_SWATCHES = ['#1f5f8b', '#8a5cd1', '#2e9e6b', '#e08a1e', '#d1495b', '#3a9188', '#c2547a', '#5b7fb0'];

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

const emptyDraft = (date, start, extra) => ({
  title: '',
  date,
  start,
  end: minutesToTime(Math.min(DAY_END * 60, timeToMinutes(start) + 60)),
  contactId: '',
  location: '',
  locLat: null,
  locLng: null,
  notes: '',
  done: false,
  repeat: 'none',
  repeatUntil: '',
  repeatDays: [],
  typeId: '',
  color: '',
  reminder: 0,
  ...extra,
});

export default function PlannerPage() {
  const { state } = useStore();
  const actions = useActions();
  const location = useLocation();
  const [mode, setMode] = useState('day'); // day | week | month
  const [cursor, setCursor] = useState(() => todayISO());
  const [viewing, setViewing] = useState(null); // occurrence being viewed read-only
  const [editing, setEditing] = useState(null); // draft being edited
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set()); // "id:recDate"

  const openNew = (date, start = '09:00', extra = {}) => setEditing(emptyDraft(date, start, extra));

  const openView = (occ) => setViewing(occ);
  const openEditFromView = () => {
    setEditing(occToDraft(viewing));
    setViewing(null);
  };

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
        repeatDays: pl.repeat === 'custom' ? pl.repeatDays || [] : [],
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
        repeatDays: pl.repeat === 'custom' ? pl.repeatDays || [] : [],
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

  const deleteEvent = (id) => {
    actions.deleteEvent(id);
    setEditing(null);
    setViewing(null);
  };

  const skipOccurrence = (id, recDate) => {
    const ev = state.events.find((e) => e.id === id);
    if (ev) {
      const overrides = { ...(ev.overrides || {}) };
      delete overrides[recDate];
      actions.updateEvent({ ...ev, skipDates: [...(ev.skipDates || []), recDate], overrides });
    }
    setEditing(null);
    setViewing(null);
  };

  const toggleDoneQuick = (occ) => {
    const master = state.events.find((e) => e.id === occ.id);
    if (!master) return;
    const nextDone = !occ.done;
    if ((master.repeat || 'none') === 'none') {
      actions.updateEvent({ ...master, done: nextDone });
    } else {
      actions.updateEvent({ ...master, doneDates: setMembership(master.doneDates, occ.recDate, nextDone) });
    }
    setViewing((v) => (v ? { ...v, done: nextDone } : v));
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

  // Multi-select: shift every selected occurrence by a fixed offset (days).
  const moveSelected = (dayOffset) => {
    for (const key of selected) {
      const [id, recDate] = key.split('|');
      const master = state.events.find((e) => e.id === id);
      if (!master) continue;
      const newDate = toISODate(addDays(recDate, dayOffset));
      if ((master.repeat || 'none') === 'none') {
        actions.updateEvent({ ...master, date: newDate });
      } else {
        const overrides = { ...(master.overrides || {}) };
        const existing = overrides[recDate] || {};
        overrides[recDate] = { ...existing, date: newDate };
        actions.updateEvent({ ...master, overrides });
      }
    }
    confirmTick();
    setSelected(new Set());
    setSelectMode(false);
  };

  const toggleSelected = (occ) => {
    const key = `${occ.id}|${occ.recDate}`;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    selectTick();
  };

  const step = (n) => {
    if (mode === 'day') setCursor(toISODate(addDays(cursor, n)));
    else if (mode === 'week') setCursor(toISODate(addDays(cursor, n * 7)));
    else setCursor(toISODate(addMonths(cursor, n)));
  };
  const weekStart = startOfWeek(fromISODate(cursor));
  const monthStart = startOfMonth(fromISODate(cursor));

  const headerLabel =
    mode === 'day'
      ? formatDayLabel(cursor)
      : mode === 'week'
      ? formatWeekRange(weekStart)
      : formatMonthLabel(monthStart);
  const headerSub =
    mode === 'day' ? (isToday(cursor) ? 'Today' : '') : mode === 'week' ? 'Week' : 'Month';

  const openDay = (iso) => {
    setCursor(iso);
    setMode('day');
  };

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
            <button className={`seg-btn${mode === 'month' ? ' seg-btn--on' : ''}`} onClick={() => setMode('month')}>
              Month
            </button>
          </div>
        </div>
        <div className="week-nav">
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous">
            <Chevron dir="left" />
          </button>
          <button className="week-label" onClick={() => setCursor(todayISO())} title="Jump to today">
            {headerLabel}
            <span className="week-sub">{headerSub}</span>
          </button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Next">
            <Chevron dir="right" />
          </button>
        </div>
        <div className="select-toggle-row">
          <button
            className={`btn btn-sm ${selectMode ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
          >
            {selectMode ? 'Cancel select' : 'Select'}
          </button>
          {selectMode && <span className="muted small">{selected.size} selected</span>}
        </div>
      </header>

      {mode === 'day' && (
        <DayView
          date={cursor}
          events={state.events}
          contacts={state.contacts}
          eventTypes={state.eventTypes || []}
          onAddAt={(start) => openNew(cursor, start)}
          onOpen={openView}
          onMove={moveOccurrence}
          selectMode={selectMode}
          selected={selected}
          onToggleSelect={toggleSelected}
        />
      )}
      {mode === 'week' && (
        <WeekView
          weekStart={weekStart}
          events={state.events}
          eventTypes={state.eventTypes || []}
          onOpenDay={openDay}
          onOpen={openView}
          onAdd={(iso) => openNew(iso)}
          selectMode={selectMode}
          selected={selected}
          onToggleSelect={toggleSelected}
        />
      )}
      {mode === 'month' && (
        <MonthView monthStart={monthStart} events={state.events} onOpenDay={openDay} cursor={cursor} />
      )}

      {!selectMode && (
        <button className="fab" onClick={() => openNew(cursor)} aria-label="New event">
          +
        </button>
      )}

      {selectMode && selected.size > 0 && (
        <div className="select-bar">
          <span>{selected.size} selected</span>
          <div className="select-bar-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => moveSelected(1)}>
              +1 day
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => moveSelected(7)}>
              +1 week
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => moveSelected(-1)}>
              −1 day
            </button>
          </div>
        </div>
      )}

      {viewing && (
        <EventDetailView
          occ={viewing}
          contacts={state.contacts}
          eventTypes={state.eventTypes || []}
          onClose={() => setViewing(null)}
          onEdit={openEditFromView}
          onToggleDone={() => toggleDoneQuick(viewing)}
        />
      )}

      <EventEditor
        editing={editing}
        contacts={state.contacts}
        eventTypes={state.eventTypes || []}
        onClose={() => setEditing(null)}
        onSave={saveEvent}
        onDelete={deleteEvent}
        onSkipOccurrence={skipOccurrence}
        setSettings={actions.setSettings}
      />
    </div>
  );
}

// Convert a viewed occurrence into an editor draft "editing" shape (mirrors
// what tapping an occurrence used to pass directly into the old editor).
function occToDraft(occ) {
  return { ...occ };
}

// --- Day timeline (long-press-to-arm drag) ----------------------------------

function DayView({ date, events, contacts, eventTypes, onAddAt, onOpen, onMove, selectMode, selected, onToggleSelect }) {
  const bodyRef = useRef(null);
  const gestureRef = useRef(null); // { key, occ, phase, startY, startX, startClientY }
  const [armedKey, setArmedKey] = useState(null);
  const [dragDy, setDragDy] = useState(0);

  const dayEvents = useMemo(() => occurrencesFor(events, date).filter((e) => e.e2 > e.s), [events, date]);
  const laid = useMemo(() => layout(dayEvents), [dayEvents]);
  const contactName = (id) => contacts.find((c) => c.id === id)?.name;
  const typeColor = (id) => eventTypes.find((t) => t.id === id)?.color;

  const hours = [];
  for (let h = DAY_START; h <= DAY_END; h++) hours.push(h);

  const handleBgClick = (e) => {
    if (e.target !== bodyRef.current && !e.target.classList.contains('hour-line')) return;
    const rect = bodyRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let mins = DAY_START * 60 + y / PX_PER_MIN;
    mins = Math.round(mins / 30) * 30;
    onAddAt(minutesToTime(Math.max(DAY_START * 60, Math.min(DAY_END * 60 - 30, mins))));
  };

  const clearGesture = () => {
    if (gestureRef.current?.timer) clearTimeout(gestureRef.current.timer);
    gestureRef.current = null;
    setArmedKey(null);
    setDragDy(0);
  };

  const onDown = (e, occ) => {
    e.stopPropagation();
    if (selectMode) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const key = `${occ.id}:${occ.recDate}`;
    const g = { key, occ, phase: 'pending', startClientY: e.clientY, startClientX: e.clientX, timer: null };
    g.timer = setTimeout(() => {
      if (gestureRef.current === g && g.phase === 'pending') {
        g.phase = 'armed';
        setArmedKey(key);
        confirmTick();
      }
    }, LONG_PRESS_MS);
    gestureRef.current = g;
  };
  const onMoveP = (e) => {
    const g = gestureRef.current;
    if (!g) return;
    const dx = e.clientX - g.startClientX;
    const dy = e.clientY - g.startClientY;
    if (g.phase === 'pending') {
      if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) {
        g.phase = 'cancelled';
        clearTimeout(g.timer);
      }
      return;
    }
    if (g.phase === 'armed') setDragDy(dy);
  };
  const onUp = (e, occ) => {
    const g = gestureRef.current;
    if (!g) return;
    clearTimeout(g.timer);
    if (g.phase === 'pending') {
      // Released before the long-press threshold, without moving: a tap.
      onOpen(occ);
    } else if (g.phase === 'armed') {
      const deltaMin = Math.round(dragDy / PX_PER_MIN / 15) * 15;
      if (deltaMin !== 0) onMove(occ, deltaMin);
    }
    clearGesture();
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
            const key = `${ev.id}:${ev.recDate}`;
            const isArmed = armedKey === key;
            const top = (ev.s - DAY_START * 60) * PX_PER_MIN;
            const height = Math.max(24, (ev.e2 - ev.s) * PX_PER_MIN - 3);
            const short = ev.e2 - ev.s < 55;
            const who = contactName(ev.contactId);
            const recurring = ev.repeat && ev.repeat !== 'none';
            const color = ev.color || typeColor(ev.typeId);
            const selKey = `${ev.id}|${ev.recDate}`;
            const isSel = selected?.has(selKey);
            return (
              <button
                key={key}
                className={`event-block${ev.done ? ' event-block--done' : ''}${short ? ' event-block--short' : ''}${isArmed ? ' event-block--armed' : ''}`}
                style={{
                  top,
                  height,
                  left: `${(ev.col / ev.cols) * 100}%`,
                  width: `calc(${100 / ev.cols}% - 4px)`,
                  '--ev': color || 'var(--accent)',
                  transform: isArmed && dragDy ? `translateY(${dragDy}px)` : undefined,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (selectMode) onToggleSelect(ev);
                }}
                onPointerDown={(e) => (selectMode ? e.stopPropagation() : onDown(e, ev))}
                onPointerMove={onMoveP}
                onPointerUp={(e) => (selectMode ? null : onUp(e, ev))}
                onPointerCancel={clearGesture}
              >
                {isArmed && <span className="drag-grip">⠿⠿</span>}
                {selectMode && <span className={`select-dot${isSel ? ' select-dot--on' : ''}`} />}
                {short ? (
                  <span className="event-title">
                    <span className="event-time-inline">
                      {isArmed ? formatTime(minutesToTime(clampStart(ev, dragDy))) : formatTime(ev.start)}
                    </span>{' '}
                    {ev.title || 'Untitled'}
                    {recurring && <span className="repeat-glyph"> {ev.isException ? '✎' : '↻'}</span>}
                  </span>
                ) : (
                  <>
                    <span className="event-time">
                      {isArmed ? formatTime(minutesToTime(clampStart(ev, dragDy))) : formatTime(ev.start)}
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
        <p className="timeline-hint muted">Tap to add. Press and hold a block to move it.</p>
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

function WeekView({ weekStart, events, eventTypes, onOpenDay, onOpen, onAdd, selectMode, selected, onToggleSelect }) {
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
                  const selKey = `${ev.id}|${ev.recDate}`;
                  const isSel = selected?.has(selKey);
                  return (
                    <button
                      key={`${ev.id}:${ev.recDate}`}
                      className={`agenda-chip${ev.done ? ' agenda-chip--done' : ''}`}
                      style={{ '--ev': ev.color || typeColor(ev.typeId) || 'var(--accent)' }}
                      onClick={() => (selectMode ? onToggleSelect(ev) : onOpen(ev))}
                    >
                      {selectMode && <span className={`select-dot${isSel ? ' select-dot--on' : ''}`} />}
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

// --- Month grid --------------------------------------------------------------

function MonthView({ monthStart, events, onOpenDay, cursor }) {
  const weeks = monthGrid(monthStart);
  const month = monthStart.getMonth();
  return (
    <div className="month-grid">
      <div className="month-dow-row">
        {WEEKDAY_LETTERS.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div className="month-week" key={wi}>
          {week.map((d) => {
            const iso = toISODate(d);
            const dayEvents = occurrencesFor(events, iso);
            const inMonth = d.getMonth() === month;
            return (
              <button
                key={iso}
                className={`month-cell${inMonth ? '' : ' month-cell--out'}${isToday(iso) ? ' month-cell--today' : ''}${iso === cursor ? ' month-cell--cursor' : ''}`}
                onClick={() => onOpenDay(iso)}
              >
                <span className="month-daynum">{d.getDate()}</span>
                <span className="month-dots">
                  {dayEvents.slice(0, 3).map((ev, i) => (
                    <span key={i} className="month-dot" style={{ background: ev.color || 'var(--accent)' }} />
                  ))}
                  {dayEvents.length > 3 && <span className="month-more">+{dayEvents.length - 3}</span>}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// --- Read-only event detail view --------------------------------------------

function EventDetailView({ occ, contacts, eventTypes, onClose, onEdit, onToggleDone }) {
  const type = eventTypes.find((t) => t.id === occ.typeId);
  const contact = contacts.find((c) => c.id === occ.contactId);
  const recurring = occ.repeat && occ.repeat !== 'none';
  const color = occ.color || type?.color;

  const directionsUrl =
    occ.locLat != null ? `https://www.google.com/maps/dir/?api=1&destination=${occ.locLat},${occ.locLng}` : null;

  return (
    <div className="editor-sheet">
      <div className="editor-sheet-drag">
        <div className="editor-sheet-grip">
          <span className="modal-handle" />
        </div>
        <div className="editor-sheet-head">
          <button className="editor-sheet-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <h2>Event</h2>
          <button className="editor-sheet-save" onClick={onEdit} aria-label="Edit">
            <PencilIcon />
          </button>
        </div>
      </div>

      <div className="editor-sheet-body">
        <div className="detail-title-row">
          {color && <span className="detail-dot" style={{ background: color }} />}
          <h1 className="detail-big-title">{occ.title || 'Untitled'}</h1>
        </div>
        {type && <span className="tag" style={{ borderColor: type.color, color: type.color }}>{type.label}</span>}

        <section className="detail-section">
          <div className="detail-field">
            <span className="detail-label">Date</span>
            <span className="detail-value">{formatShortDate(occ.occDate || occ.date)}</span>
          </div>
          <div className="detail-field">
            <span className="detail-label">Time</span>
            <span className="detail-value">
              {formatTime(occ.start)} – {formatTime(occ.end)}
            </span>
          </div>
          {recurring && (
            <div className="detail-field">
              <span className="detail-label">Repeats</span>
              <span className="detail-value">{repeatLabel(occ.repeat, occ.repeatDays)}</span>
            </div>
          )}
          {occ.reminder > 0 && (
            <div className="detail-field">
              <span className="detail-label">Reminder</span>
              <span className="detail-value">{occ.reminder} min before</span>
            </div>
          )}
          {occ.location && (
            <div className="detail-field">
              <span className="detail-label">Location</span>
              <span className="detail-value">{occ.location}</span>
            </div>
          )}
          {contact && (
            <div className="detail-field">
              <span className="detail-label">With</span>
              <span className="detail-value">{contact.name}</span>
            </div>
          )}
        </section>

        {occ.locLat != null && (
          <section className="detail-section">
            <MiniMapPicker lat={occ.locLat} lng={occ.locLng} onPick={() => {}} />
            <a className="btn btn-primary full" style={{ marginTop: 10 }} href={directionsUrl} target="_blank" rel="noopener">
              ➤ Directions
            </a>
          </section>
        )}

        {occ.notes && (
          <section className="detail-section">
            <span className="detail-label">Notes</span>
            <p className="notes-text">{occ.notes}</p>
          </section>
        )}

        <label className="check-row detail-done-row">
          <input type="checkbox" checked={!!occ.done} onChange={onToggleDone} />
          <span>Mark as done</span>
        </label>
      </div>
    </div>
  );
}

// --- Event editor (full-page sheet) -----------------------------------------

function EventEditor({ editing, contacts, eventTypes, onClose, onSave, onDelete, onSkipOccurrence, setSettings }) {
  const [draft, setDraft] = useState(null);
  const [initialJson, setInitialJson] = useState('');
  const [showMap, setShowMap] = useState(false);
  const recurringMaster = !!editing?.id && !!editing?.repeat && editing.repeat !== 'none';

  const key = editing ? `${editing.id || 'new'}|${editing.recDate || editing.date}|${editing.start}` : null;
  const keyRef = useRef(null);
  if (editing && keyRef.current !== key) {
    keyRef.current = key;
    const d = {
      id: editing.id,
      scope: recurringMaster ? 'this' : 'all',
      title: editing.title,
      start: editing.start,
      end: editing.end,
      contactId: editing.contactId || '',
      location: editing.location || '',
      locLat: editing.locLat ?? null,
      locLng: editing.locLng ?? null,
      notes: editing.notes || '',
      date: recurringMaster ? editing.occDate || editing.date : editing.date,
      done: !!editing.done,
      repeat: editing.repeat || 'none',
      repeatUntil: editing.repeatUntil || '',
      repeatDays: editing.repeatDays || [],
      typeId: editing.typeId || '',
      color: editing.color || '',
      reminder: Number(editing.reminder) || 0,
      recDate: editing.recDate || editing.date,
      occDate: editing.occDate || editing.date,
      masterDate: editing.date,
      base: editing.base || null,
    };
    setDraft(d);
    setInitialJson(JSON.stringify(d));
    setShowMap(d.locLat != null);
  }
  if (!editing && keyRef.current !== null) {
    keyRef.current = null;
  }

  if (!editing || !draft) return null;

  const dirty = JSON.stringify(draft) !== initialJson;

  const applyScope = (s) => {
    if (s === draft.scope) return;
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
        repeatDays: editing.repeatDays || [],
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

  const thisScope = draft.scope === 'this';
  const recurring = draft.repeat !== 'none';

  const setReminder = async (mins) => {
    setDraft({ ...draft, reminder: mins });
    if (mins > 0) {
      await requestNotificationPermission();
      setSettings({ notifications: true });
    }
  };

  const toggleWeekday = (d) => {
    const set = new Set(draft.repeatDays || []);
    if (set.has(d)) set.delete(d);
    else set.add(d);
    setDraft({ ...draft, repeatDays: [...set].sort() });
  };

  const doSave = () => {
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
      repeatDays: draft.repeatDays,
      done: draft.done,
      fields: {
        title: draft.title.trim() || 'Untitled',
        start: draft.start,
        end,
        contactId: draft.contactId || '',
        location: draft.location,
        locLat: draft.locLat,
        locLng: draft.locLng,
        notes: draft.notes,
        typeId: draft.typeId,
        color: draft.color,
        reminder: draft.reminder,
      },
    });
  };

  return (
    <EditorSheet
      open={!!editing}
      title={editing.id ? 'Edit event' : 'New event'}
      dirty={dirty}
      onSave={doSave}
      onDiscard={onClose}
    >
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

        {eventTypes.length > 0 && (
          <div className="field">
            <span>Type</span>
            <div className="chips">
              <button className={`chip${!draft.typeId ? ' chip--on' : ''}`} onClick={() => setDraft({ ...draft, typeId: '' })}>
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
            <Select
              value={draft.repeat}
              onChange={(v) => setDraft({ ...draft, repeat: v })}
              options={REPEAT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </label>
        )}
        {!thisScope && draft.repeat === 'custom' && (
          <div className="field">
            <span>On these days</span>
            <div className="weekday-picker">
              {WEEKDAY_LETTERS.map((l, i) => (
                <button
                  key={i}
                  type="button"
                  className={`weekday-btn${(draft.repeatDays || []).includes(i) ? ' weekday-btn--on' : ''}`}
                  onClick={() => toggleWeekday(i)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
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
              {repeatLabel(draft.repeat, draft.repeatDays)}
              {draft.repeatUntil ? '' : ' · no end date'}
            </span>
          </label>
        )}
        {thisScope && (
          <p className="muted small scope-note">
            Editing only this occurrence{draft.date !== draft.recDate ? ' (moved from its usual day)' : ''}.
          </p>
        )}

        <label className="field">
          <span>Reminder</span>
          <Select
            value={draft.reminder}
            onChange={(v) => setReminder(Number(v))}
            options={REMINDER_OPTIONS.map((o) => ({ value: o.v, label: o.l }))}
          />
          {draft.reminder > 0 && !notificationsSupported() && (
            <span className="muted small">This browser can't show notifications.</span>
          )}
        </label>

        <label className="field">
          <span>With</span>
          <Select
            value={draft.contactId || ''}
            onChange={(v) => setDraft({ ...draft, contactId: v })}
            placeholder="No one linked"
            options={[{ value: '', label: 'No one linked' }, ...contacts.map((c) => ({ value: c.id, label: c.name }))]}
          />
        </label>

        <div className="field">
          <span>Location</span>
          <div className="location-row">
            <input
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              placeholder="Optional"
            />
            <button
              type="button"
              className={`btn btn-ghost btn-sm location-pin-btn${showMap ? ' btn-primary' : ''}`}
              onClick={() => setShowMap((v) => !v)}
            >
              📍 Pin
            </button>
          </div>
          {showMap && (
            <>
              <MiniMapPicker
                lat={draft.locLat}
                lng={draft.locLng}
                onPick={(lat, lng) => {
                  setDraft({ ...draft, locLat: lat, locLng: lng });
                  selectTick();
                }}
              />
              <div className="mini-map-actions">
                <span className="muted small">
                  {draft.locLat != null ? 'Tap the map to move the pin.' : 'Tap the map to drop a temporary pin.'}
                </span>
                {draft.locLat != null && (
                  <button
                    type="button"
                    className="btn btn-danger-ghost btn-sm"
                    onClick={() => setDraft({ ...draft, locLat: null, locLng: null })}
                  >
                    Clear pin
                  </button>
                )}
              </div>
            </>
          )}
        </div>

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

        {editing.id && (
          <div className="del-group del-group--stack">
            {recurringMaster ? (
              <>
                <button className="btn btn-danger-ghost" onClick={() => onSkipOccurrence(editing.id, draft.recDate)}>
                  Delete this day
                </button>
                <button className="btn btn-danger-ghost" onClick={() => onDelete(editing.id)}>
                  Delete series
                </button>
              </>
            ) : (
              <button className="btn btn-danger-ghost" onClick={() => onDelete(editing.id)}>
                Delete event
              </button>
            )}
          </div>
        )}
      </div>
    </EditorSheet>
  );
}

// --- Layout helper -----------------------------------------------------------

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
function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M4 20l1-4.5L15.5 5 19 8.5 8.5 19 4 20z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
