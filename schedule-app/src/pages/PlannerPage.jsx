import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore, useActions } from '../data/store.jsx';
import EditorSheet from '../components/EditorSheet.jsx';
import Select from '../components/Select.jsx';
import MiniMapPicker from '../components/MiniMapPicker.jsx';
import { Brand } from '../components/Logo.jsx';
import { confirmTick, selectTick } from '../data/haptics.js';
import { useBackDismiss } from '../data/useBackDismiss.js';
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

const emptyDraft = (date, start, extra, opts = {}) => {
  const dayEndHour = opts.dayEndHour ?? DAY_END;
  const duration = opts.duration ?? 60;
  const reminder = opts.reminder ?? 0;
  return {
    title: '',
    date,
    start,
    end: minutesToTime(Math.min(dayEndHour * 60, timeToMinutes(start) + duration)),
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
    reminder,
    ...extra,
  };
};

const PENDING_DRAFT_KEY = 'keystone.pendingEventDraft';

export default function PlannerPage() {
  const { state } = useStore();
  const actions = useActions();
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState('day'); // day | week | month
  const [cursor, setCursor] = useState(() => todayISO());
  const [viewing, setViewing] = useState(null); // occurrence being viewed read-only
  const [editing, setEditing] = useState(null); // draft being edited
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set()); // "id:recDate"

  const dayStartHour = state.settings?.timelineStartHour ?? DAY_START;
  const dayEndHour = state.settings?.timelineEndHour ?? DAY_END;
  const defaultDuration = state.settings?.defaultEventDuration ?? 60;
  const defaultReminder = state.settings?.defaultReminderLead ?? 0;

  const openNew = (date, start = '09:00', extra = {}) =>
    setEditing(
      emptyDraft(date, start, extra, { dayEndHour, duration: defaultDuration, reminder: defaultReminder })
    );

  const openView = (occ) => setViewing(occ);
  const openEditFromView = () => {
    setEditing(occToDraft(viewing));
    setViewing(null);
  };

  // Opened from a person's page ("+ add event for this contact"), or from
  // the Home page's quick-add menu, or returning from the "select location"
  // full-map picker with a draft that was stashed before navigating away.
  useEffect(() => {
    const cid = location.state?.newEventContact;
    if (cid) {
      openNew(todayISO(), '09:00', { contactId: cid });
      window.history.replaceState({}, '');
      return;
    }
    if (location.state?.quickNewEvent) {
      openNew(todayISO(), '09:00');
      window.history.replaceState({}, '');
      return;
    }
    const raw = sessionStorage.getItem(PENDING_DRAFT_KEY);
    if (raw) {
      sessionStorage.removeItem(PENDING_DRAFT_KEY);
      try {
        const { draft, savedAt } = JSON.parse(raw);
        if (draft && Date.now() - savedAt < 10 * 60 * 1000) {
          const picked = location.state?.locationPicked;
          setEditing(picked ? { ...draft, locLat: picked.lat, locLng: picked.lng } : draft);
        }
      } catch {
        // ignore malformed stash
      }
    }
    window.history.replaceState({}, '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Stash the in-progress event draft and hand off to the full map page to
  // pick a location — EventEditor unmounts during that navigation, so the
  // draft can't just live in its own state.
  const beginLocationPick = (draftSnapshot) => {
    sessionStorage.setItem(
      PENDING_DRAFT_KEY,
      JSON.stringify({ draft: draftSnapshot, savedAt: Date.now() })
    );
    navigate('/map', {
      state: {
        picking: true,
        returnTo: '/planner',
        initialLat: draftSnapshot.locLat,
        initialLng: draftSnapshot.locLng,
      },
    });
  };

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

  // Drag-to-reschedule: shift an occurrence by whole minutes and/or whole
  // days (dragging left/right moves it to the previous/next day).
  const moveOccurrence = (occ, deltaMin, dayOffset = 0) => {
    const master = state.events.find((e) => e.id === occ.id);
    if (!master) return;
    const dur = timeToMinutes(occ.end) - timeToMinutes(occ.start);
    let ns = timeToMinutes(occ.start) + deltaMin;
    ns = Math.max(dayStartHour * 60, Math.min(dayEndHour * 60 - dur, ns));
    const start = minutesToTime(ns);
    const end = minutesToTime(ns + dur);
    const newDate = dayOffset ? toISODate(addDays(occ.occDate, dayOffset)) : occ.occDate;
    if ((master.repeat || 'none') === 'none') {
      actions.updateEvent({ ...master, date: newDate, start, end });
    } else {
      const overrides = { ...(master.overrides || {}) };
      overrides[occ.recDate] = {
        title: occ.title,
        start,
        end,
        contactId: occ.contactId,
        location: occ.location,
        notes: occ.notes,
        ...(newDate !== occ.recDate ? { date: newDate } : {}),
      };
      actions.updateEvent({ ...master, overrides });
    }
  };

  // Resolve the currently-selected "id|recDate" keys into full occurrence
  // objects (with resolved start/end and display date) by re-expanding each
  // distinct date they fall on — selection can span multiple days in Week view.
  const resolveSelectedOccurrences = () => {
    const byDate = new Map();
    const out = [];
    for (const key of selected) {
      const [id, recDate] = key.split('|');
      if (!byDate.has(recDate)) byDate.set(recDate, occurrencesFor(state.events, recDate));
      const occ = byDate.get(recDate).find((o) => o.id === id && o.recDate === recDate);
      if (occ) out.push(occ);
    }
    return out;
  };

  // Multi-select: shift every selected occurrence by a fixed day and/or
  // minute offset (used by both the quick-move bar and the timeline drag).
  const moveSelected = ({ dayOffset = 0, minOffset = 0 } = {}) => {
    for (const occ of resolveSelectedOccurrences()) {
      const master = state.events.find((e) => e.id === occ.id);
      if (!master) continue;
      const dur = occ.e2 - occ.s;
      let ns = occ.s + minOffset;
      ns = Math.max(dayStartHour * 60, Math.min(dayEndHour * 60 - dur, ns));
      const start = minutesToTime(ns);
      const end = minutesToTime(ns + dur);
      const newDate = dayOffset ? toISODate(addDays(occ.occDate, dayOffset)) : occ.occDate;
      if ((master.repeat || 'none') === 'none') {
        actions.updateEvent({ ...master, date: newDate, start, end });
      } else {
        const overrides = { ...(master.overrides || {}) };
        overrides[occ.recDate] = {
          title: occ.title,
          start,
          end,
          contactId: occ.contactId,
          location: occ.location,
          notes: occ.notes,
          ...(newDate !== occ.recDate ? { date: newDate } : {}),
        };
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

  // Uses the functional setCursor form (not the `cursor` closed over above)
  // so that stale closures — e.g. a drag-to-page gesture's window-level
  // listeners, wired once at arm time — still always step from the
  // *current* day/week/month rather than replaying from whatever cursor
  // value existed when the closure was created.
  const step = (n) => {
    setCursor((c) => {
      if (mode === 'day') return toISODate(addDays(c, n));
      if (mode === 'week') return toISODate(addDays(c, n * 7));
      return toISODate(addMonths(c, n));
    });
  };

  // Direction of the most recent cursor change, for the slide-in transition
  // — works no matter how cursor changed (chevron, swipe, drag-to-page,
  // jump-to-today, tapping a month cell) since it just diffs ISO date
  // strings, which sort correctly as plain strings.
  const prevCursorRef = useRef(cursor);
  const navDir = cursor > prevCursorRef.current ? 1 : cursor < prevCursorRef.current ? -1 : 0;
  useEffect(() => {
    prevCursorRef.current = cursor;
  }, [cursor]);

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
          <button className="today-btn" onClick={() => setCursor(todayISO())} aria-label="Jump to today" title="Jump to today">
            <TodayIcon />
          </button>
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
          onMoveSelected={moveSelected}
          onNavigateDay={step}
          direction={navDir}
          selectMode={selectMode}
          selected={selected}
          onToggleSelect={toggleSelected}
          zoom={state.settings?.timelineZoom ?? 1}
          onZoom={(z) => actions.setSettings({ timelineZoom: z })}
          dayStart={dayStartHour}
          dayEnd={dayEndHour}
          opacity={state.settings?.isPro ? state.settings?.eventBlockOpacity ?? 100 : 100}
          tasks={state.settings?.showTasksOnTimeline ? state.tasks : null}
          onToggleTask={(t) => actions.updateTask({ ...t, done: !t.done })}
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
        <MonthView monthStart={monthStart} events={state.events} onOpenDay={openDay} cursor={cursor} onSwipe={step} />
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
            <button className="btn btn-ghost btn-sm" onClick={() => moveSelected({ dayOffset: 1 })}>
              +1 day
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => moveSelected({ dayOffset: 7 })}>
              +1 week
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => moveSelected({ dayOffset: -1 })}>
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
          isPro={!!state.settings?.isPro}
          onClose={() => setViewing(null)}
          onEdit={openEditFromView}
          onToggleDone={() => toggleDoneQuick(viewing)}
        />
      )}

      <EventEditor
        editing={editing}
        events={state.events}
        contacts={state.contacts}
        eventTypes={state.eventTypes || []}
        settings={state.settings}
        onClose={() => setEditing(null)}
        onSave={saveEvent}
        onDelete={deleteEvent}
        onSkipOccurrence={skipOccurrence}
        setSettings={actions.setSettings}
        onSelectLocation={beginLocationPick}
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

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.2;

const EDGE_ZONE_PX = 30; // how close to the timeline's edge before a drag pages a day
const SWIPE_THRESHOLD_PX = 60; // horizontal drag distance to swipe-navigate a day/month

// Which edge (if any) of `rect` a pointer at `clientX` has reached. Used to
// require a drag reach the very side of the page before it pages a day,
// rather than any small horizontal wobble.
function edgeOf(clientX, rect, zone) {
  if (clientX <= rect.left + zone) return 'left';
  if (clientX >= rect.right - zone) return 'right';
  return null;
}

function DayView({
  date,
  events,
  contacts,
  eventTypes,
  onAddAt,
  onOpen,
  onMove,
  onMoveSelected,
  onNavigateDay,
  direction = 0,
  selectMode,
  selected,
  onToggleSelect,
  zoom = 1,
  onZoom,
  dayStart = DAY_START,
  dayEnd = DAY_END,
  opacity = 100,
  tasks,
  onToggleTask,
}) {
  const bodyRef = useRef(null);
  const gestureRef = useRef(null); // { key, occ, phase, startY, startX, startClientY }
  const groupGestureRef = useRef(null); // { phase, startClientX, startClientY, timer, lastMinSnap, lastDayOffset }
  const groupClickSuppressRef = useRef(false); // swallow the native click that follows a group-gesture pointerup
  const pinchRef = useRef(null); // { pointers: Map<id,{x,y}>, startDist, startZoom }
  const swipeRef = useRef(null); // { pointerId, startX, startY } — single-pointer swipe to change day
  const [armedKey, setArmedKey] = useState(null);
  const [dragDy, setDragDy] = useState(0);
  const [dragDx, setDragDx] = useState(0);
  const [groupDragging, setGroupDragging] = useState(false);
  const [groupDrag, setGroupDrag] = useState({ dy: 0, dx: 0, dayOffset: 0 });

  const pxPerHour = PX_PER_HOUR * zoom;
  const pxPerMin = pxPerHour / 60;

  const dayEvents = useMemo(() => occurrencesFor(events, date).filter((e) => e.e2 > e.s), [events, date]);
  const laid = useMemo(() => layout(dayEvents), [dayEvents]);
  const contactName = (id) => contacts.find((c) => c.id === id)?.name;
  const typeColor = (id) => eventTypes.find((t) => t.id === id)?.color;

  const hours = [];
  for (let h = dayStart; h <= dayEnd; h++) hours.push(h);

  const pendingTasks = useMemo(
    () => (tasks ? tasks.filter((t) => !t.done) : null),
    [tasks]
  );

  const bgSwipeSuppressRef = useRef(false); // swallow the click that follows a background swipe-to-navigate

  const handleBgClick = (e) => {
    if (bgSwipeSuppressRef.current) {
      bgSwipeSuppressRef.current = false;
      return;
    }
    if (e.target !== bodyRef.current && !e.target.classList.contains('hour-line')) return;
    const rect = bodyRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let mins = dayStart * 60 + y / pxPerMin;
    mins = Math.round(mins / 30) * 30;
    onAddAt(minutesToTime(Math.max(dayStart * 60, Math.min(dayEnd * 60 - 30, mins))));
  };

  // Pinch-to-zoom: two touch pointers on the timeline scale pxPerHour by how
  // much their distance apart has changed since the pinch started. A single
  // pointer swipes the whole day forward/backward instead (swipeRef).
  const onBodyPointerDown = (e) => {
    if (e.pointerType === 'touch') {
      if (!pinchRef.current) pinchRef.current = { pointers: new Map(), startDist: 0, startZoom: zoom };
      pinchRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinchRef.current.pointers.size === 2) {
        const [a, b] = [...pinchRef.current.pointers.values()];
        pinchRef.current.startDist = Math.hypot(a.x - b.x, a.y - b.y);
        pinchRef.current.startZoom = zoom;
        clearGesture(); // a second finger landing cancels any armed drag
        swipeRef.current = null; // ...and any single-finger swipe-to-navigate
        return;
      }
    }
    if (!swipeRef.current) {
      // A swipe that crosses to a different element never fires a native
      // click (mousedown/mouseup targets differ), so the suppress flag set
      // on release can otherwise outlive its gesture and eat the next
      // unrelated tap-to-add. Clearing it here makes it self-correcting.
      bgSwipeSuppressRef.current = false;
      swipeRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
    }
  };
  const onBodyPointerMove = (e) => {
    const p = pinchRef.current;
    if (!p || !p.pointers.has(e.pointerId)) return;
    p.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (p.pointers.size === 2 && p.startDist > 20) {
      const [a, b] = [...p.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(((p.startZoom * dist) / p.startDist) * 20) / 20));
      onZoom?.(next);
    }
  };
  const onBodyPointerUp = (e) => {
    const s = swipeRef.current;
    if (s && s.pointerId === e.pointerId) {
      swipeRef.current = null;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.4) {
        bgSwipeSuppressRef.current = true;
        onNavigateDay?.(dx < 0 ? 1 : -1);
        confirmTick();
      }
    }
    const p = pinchRef.current;
    if (!p) return;
    p.pointers.delete(e.pointerId);
    if (p.pointers.size < 2) p.startDist = 0;
    if (p.pointers.size === 0) pinchRef.current = null;
  };

  const clearGesture = () => {
    if (gestureRef.current?.timer) clearTimeout(gestureRef.current.timer);
    gestureRef.current = null;
    setArmedKey(null);
    setDragDy(0);
    setDragDx(0);
  };

  const onDown = (e, occ) => {
    e.stopPropagation();
    if (selectMode) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const key = `${occ.id}:${occ.recDate}`;
    const g = {
      key,
      occ,
      phase: 'pending', // pending -> armed (long-press held) | swiping (moved before long-press fired)
      startClientY: e.clientY,
      startClientX: e.clientX,
      timer: null,
      lastSnap: 0,
      // Net days paged during this drag — always moves one at a time, only
      // once the pointer reaches the very edge of the timeline, and paging
      // back past the origin un-pages the same way (see onMoveP).
      pagedOffset: 0,
      lastEdge: null,
    };
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
        // Moved before the long-press armed: not a reschedule-drag. Keep
        // tracking so a fast horizontal swipe can still change the day
        // (same as swiping empty timeline space) — evaluated on release.
        g.phase = 'swiping';
        clearTimeout(g.timer);
      }
      return;
    }
    if (g.phase === 'armed') {
      setDragDy(dy);
      setDragDx(dx);
      const snap = Math.round(dy / pxPerMin / 15) * 15;
      if (snap !== g.lastSnap) {
        g.lastSnap = snap;
        selectTick();
      }
      // Page the visible day one at a time, only once the pointer reaches
      // the very edge of the timeline — dragging back toward center re-arms
      // the edge so paging again needs a deliberate return-and-reapproach,
      // not just continuing to drift further past the threshold.
      if (bodyRef.current) {
        const rect = bodyRef.current.getBoundingClientRect();
        const edge = edgeOf(e.clientX, rect, EDGE_ZONE_PX);
        if (edge && edge !== g.lastEdge) {
          const dir = edge === 'right' ? 1 : -1;
          g.pagedOffset += dir;
          onNavigateDay?.(dir);
          confirmTick();
        }
        g.lastEdge = edge;
      }
    }
  };
  const onUp = (e, occ) => {
    const g = gestureRef.current;
    if (!g) return;
    clearTimeout(g.timer);
    if (g.phase === 'pending') {
      // Released before the long-press threshold, without moving: a tap.
      onOpen(occ);
    } else if (g.phase === 'swiping') {
      const dx = e.clientX - g.startClientX;
      const dy = e.clientY - g.startClientY;
      if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.4) {
        onNavigateDay?.(dx < 0 ? 1 : -1);
        confirmTick();
      }
    } else if (g.phase === 'armed') {
      const deltaMin = Math.round(dragDy / pxPerMin / 15) * 15;
      const dayOffset = g.pagedOffset;
      if (deltaMin !== 0 || dayOffset !== 0) {
        onMove(occ, deltaMin, dayOffset);
        confirmTick();
      }
    }
    clearGesture();
  };

  // Keep refs pointing at the latest onMoveP/onUp closures. They're recreated
  // every render (so they always see current dragDy/dragDx state), but the
  // window listener below is only wired up once per drag (see its own
  // comment) — without this indirection it would keep calling the stale
  // arm-time closure, which always saw dragDy/dragDx as 0 and silently
  // dropped the time change on release.
  const onMovePRef = useRef(onMoveP);
  onMovePRef.current = onMoveP;
  const onUpRef = useRef(onUp);
  onUpRef.current = onUp;

  // Once armed, track the pointer at the window level rather than relying on
  // the originally-pressed DOM node: paging the visible day re-renders the
  // event layer for the new day, which can drop that node from the tree
  // (it's no longer part of that day's occurrences) and would otherwise
  // silently end the gesture (lost pointer capture) mid-drag.
  useEffect(() => {
    if (!armedKey) return;
    const move = (e) => onMovePRef.current(e);
    const up = (e) => onUpRef.current(e, gestureRef.current?.occ);
    const cancel = () => clearGesture();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armedKey]);

  // Multi-select group drag: press-and-hold a selected block to move every
  // selected occurrence together — vertically for time, horizontally for
  // day (one day per edge reached, same as the single-event drag), committed
  // only on release so a change of mind mid-drag costs nothing.
  const clearGroupGesture = () => {
    if (groupGestureRef.current?.timer) clearTimeout(groupGestureRef.current.timer);
    groupGestureRef.current = null;
    setGroupDragging(false);
    setGroupDrag({ dy: 0, dx: 0, dayOffset: 0 });
  };

  const onGroupDown = (e, occ) => {
    e.stopPropagation();
    // The pointerup this gesture handles is always followed by a native
    // "click" on the same element — React re-renders (updating `isSel`)
    // between the two, so a click handler reading `isSel` fresh would see
    // POST-toggle state and immediately undo what pointerup just did. Flag
    // it here and swallow that one click instead of trusting its closure.
    groupClickSuppressRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const g = {
      occ,
      phase: 'pending',
      startClientX: e.clientX,
      startClientY: e.clientY,
      timer: null,
      lastMinSnap: 0,
      dayOffset: 0,
      lastEdge: null,
    };
    g.timer = setTimeout(() => {
      if (groupGestureRef.current === g && g.phase === 'pending') {
        g.phase = 'armed';
        setGroupDragging(true);
        confirmTick();
      }
    }, LONG_PRESS_MS);
    groupGestureRef.current = g;
  };
  const onGroupMove = (e) => {
    const g = groupGestureRef.current;
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
    if (g.phase === 'armed') {
      if (bodyRef.current) {
        const rect = bodyRef.current.getBoundingClientRect();
        const edge = edgeOf(e.clientX, rect, EDGE_ZONE_PX);
        if (edge && edge !== g.lastEdge) {
          g.dayOffset += edge === 'right' ? 1 : -1;
          confirmTick(); // a stronger tick specifically for crossing a day boundary
        }
        g.lastEdge = edge;
      }
      setGroupDrag({ dy, dx, dayOffset: g.dayOffset });
      const minSnap = Math.round(dy / pxPerMin / 15) * 15;
      if (minSnap !== g.lastMinSnap) {
        g.lastMinSnap = minSnap;
        selectTick();
      }
    }
  };
  const onGroupUp = (e, occ) => {
    const g = groupGestureRef.current;
    if (!g) return;
    clearTimeout(g.timer);
    if (g.phase === 'pending') {
      // Released before the long-press threshold, without moving: a tap
      // deselects (it was already selected to be draggable at all).
      onToggleSelect(occ);
    } else if (g.phase === 'armed') {
      const minOffset = Math.round(groupDrag.dy / pxPerMin / 15) * 15;
      const dayOffset = groupDrag.dayOffset;
      if (minOffset !== 0 || dayOffset !== 0) {
        onMoveSelected({ dayOffset, minOffset });
      }
    }
    clearGroupGesture();
  };

  return (
    <div className="timeline">
      {pendingTasks && pendingTasks.length > 0 && (
        <div className="timeline-tasks">
          {pendingTasks.map((t) => (
            <button key={t.id} className="timeline-task-chip" onClick={() => onToggleTask?.(t)}>
              <span className="timeline-task-dot" />
              {t.title}
            </button>
          ))}
        </div>
      )}
      <div
        className="timeline-body"
        ref={bodyRef}
        style={{ height: (dayEnd - dayStart + 1) * pxPerHour }}
        onClick={handleBgClick}
        onPointerDown={onBodyPointerDown}
        onPointerMove={onBodyPointerMove}
        onPointerUp={onBodyPointerUp}
        onPointerCancel={onBodyPointerUp}
      >
        <div
          key={date}
          className={`day-content${direction > 0 ? ' day-content--in-right' : direction < 0 ? ' day-content--in-left' : ''}`}
        >
          {hours.map((h) => (
            <div className="hour-row" key={h} style={{ height: pxPerHour }}>
              <span className="hour-label">{formatTime(`${String(h).padStart(2, '0')}:00`)}</span>
              <div className="hour-line" />
            </div>
          ))}

          <div className="event-layer">
            {laid.map((ev) => {
            const key = `${ev.id}:${ev.recDate}`;
            if (armedKey === key) return null; // rendered separately as a floating ghost below
            const top = (ev.s - dayStart * 60) * pxPerMin;
            const height = Math.max(24, (ev.e2 - ev.s) * pxPerMin - 3);
            const short = ev.e2 - ev.s < 55;
            const who = contactName(ev.contactId);
            const recurring = ev.repeat && ev.repeat !== 'none';
            const color = ev.color || typeColor(ev.typeId);
            const selKey = `${ev.id}|${ev.recDate}`;
            const isSel = selected?.has(selKey);
            const isGroupDragging = groupDragging && isSel;
            const groupDy = isGroupDragging ? groupDrag.dy : 0;
            const groupDayOffset = isGroupDragging ? groupDrag.dayOffset : 0;
            const rubberX = isGroupDragging ? Math.max(-18, Math.min(18, groupDrag.dx * 0.2)) : 0;
            const displayStartMin = isGroupDragging
              ? clampStart(ev, groupDy, pxPerMin, dayStart, dayEnd)
              : ev.s;
            return (
              <button
                key={key}
                className={`event-block${ev.done ? ' event-block--done' : ''}${short ? ' event-block--short' : ''}${isGroupDragging ? ' event-block--armed' : ''}${isGroupDragging && groupDayOffset !== 0 ? ' event-block--leaving' : ''}`}
                style={{
                  top,
                  height,
                  left: `${(ev.col / ev.cols) * 100}%`,
                  width: `calc(${100 / ev.cols}% - 4px)`,
                  '--ev': color || 'var(--accent)',
                  '--ev-opacity': opacity / 100,
                  transform: isGroupDragging ? `translateY(${groupDy}px) translateX(${rubberX}px)` : undefined,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (groupClickSuppressRef.current) {
                    groupClickSuppressRef.current = false;
                    return;
                  }
                  if (!selectMode) return;
                  onToggleSelect(ev);
                }}
                onPointerDown={(e) => {
                  if (selectMode) {
                    if (isSel) onGroupDown(e, ev);
                    else e.stopPropagation();
                  } else {
                    onDown(e, ev);
                  }
                }}
                onPointerMove={(e) => {
                  if (selectMode) {
                    if (isSel) onGroupMove(e);
                  } else {
                    onMoveP(e);
                  }
                }}
                onPointerUp={(e) => {
                  if (selectMode) {
                    if (isSel) onGroupUp(e, ev);
                  } else {
                    onUp(e, ev);
                  }
                }}
                onPointerCancel={() => {
                  clearGesture();
                  clearGroupGesture();
                  groupClickSuppressRef.current = false;
                }}
              >
                {isGroupDragging && <span className="drag-grip">⠿⠿</span>}
                {selectMode && <span className={`select-dot${isSel ? ' select-dot--on' : ''}`} />}
                {short ? (
                  <span className="event-title">
                    <span className="event-time-inline">{formatTime(minutesToTime(displayStartMin))}</span>{' '}
                    {ev.title || 'Untitled'}
                    {recurring && <span className="repeat-glyph"> {ev.isException ? '✎' : '↻'}</span>}
                  </span>
                ) : (
                  <>
                    <span className="event-time">
                      {formatTime(minutesToTime(displayStartMin))}
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

        {armedKey &&
          gestureRef.current?.occ &&
          (() => {
            const occ = gestureRef.current.occ;
            const top = (occ.s - dayStart * 60) * pxPerMin;
            const height = Math.max(24, (occ.e2 - occ.s) * pxPerMin - 3);
            const short = occ.e2 - occ.s < 55;
            const who = contactName(occ.contactId);
            const recurring = occ.repeat && occ.repeat !== 'none';
            const color = occ.color || typeColor(occ.typeId);
            const rubberX = Math.max(-18, Math.min(18, dragDx * 0.2));
            const displayStartMin = clampStart(occ, dragDy, pxPerMin, dayStart, dayEnd);
            return (
              <div className="event-layer event-layer--ghost">
                <div
                  className={`event-block event-block--armed${short ? ' event-block--short' : ''}${occ.done ? ' event-block--done' : ''}`}
                  style={{
                    top,
                    height,
                    left: 4,
                    width: 'calc(100% - 8px)',
                    '--ev': color || 'var(--accent)',
                    '--ev-opacity': opacity / 100,
                    transform: `translateY(${dragDy}px) translateX(${rubberX}px)`,
                  }}
                >
                  <span className="drag-grip">⠿⠿</span>
                  {short ? (
                    <span className="event-title">
                      <span className="event-time-inline">{formatTime(minutesToTime(displayStartMin))}</span>{' '}
                      {occ.title || 'Untitled'}
                      {recurring && <span className="repeat-glyph"> {occ.isException ? '✎' : '↻'}</span>}
                    </span>
                  ) : (
                    <>
                      <span className="event-time">
                        {formatTime(minutesToTime(displayStartMin))}
                        {recurring && <span className="repeat-glyph"> {occ.isException ? '✎' : '↻'}</span>}
                        {occ.reminder > 0 && <span className="repeat-glyph"> 🔔</span>}
                      </span>
                      <span className="event-title">{occ.title || 'Untitled'}</span>
                      {who && <span className="event-who">{who}</span>}
                    </>
                  )}
                </div>
              </div>
            );
          })()}
      </div>
      {groupDragging && (
        <div className="group-drag-indicator">
          {groupDrag.dayOffset !== 0 && <strong>{formatDayLabel(addDays(date, groupDrag.dayOffset))}</strong>}
          <span>{formatOffsetMinutes(Math.round(groupDrag.dy / pxPerMin / 15) * 15)}</span>
        </div>
      )}
    </div>
  );
}

function formatOffsetMinutes(mins) {
  if (!mins) return 'Same time';
  const sign = mins < 0 ? '−' : '+';
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h ? `${h}h` : ''}${m ? `${m}m` : h ? '' : '0m'}`;
}

function clampStart(ev, dy, pxPerMin, dayStart, dayEnd) {
  const delta = Math.round(dy / pxPerMin / 15) * 15;
  const dur = ev.e2 - ev.s;
  return Math.max(dayStart * 60, Math.min(dayEnd * 60 - dur, ev.s + delta));
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

function MonthView({ monthStart, events, onOpenDay, cursor, onSwipe }) {
  const weeks = monthGrid(monthStart);
  const month = monthStart.getMonth();
  const swipeRef = useRef(null);
  const suppressClickRef = useRef(false);

  const onPointerDown = (e) => {
    // A swipe that crosses from one cell to another never fires a native
    // click at all (mousedown/mouseup targets differ), so the suppress flag
    // set below can otherwise outlive its gesture and eat the next
    // unrelated tap. Clearing it at the start of every new gesture makes it
    // self-correcting instead of depending on a click to consume it.
    suppressClickRef.current = false;
    swipeRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
  };
  const onPointerUp = (e) => {
    const s = swipeRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    swipeRef.current = null;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.4) {
      suppressClickRef.current = true;
      onSwipe?.(dx < 0 ? 1 : -1);
      confirmTick();
    }
  };
  const onClickCapture = (e) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.stopPropagation();
    }
  };

  return (
    <div
      className="month-grid"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        swipeRef.current = null;
      }}
      onClickCapture={onClickCapture}
    >
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

function EventDetailView({ occ, contacts, eventTypes, isPro, onClose, onEdit, onToggleDone }) {
  const navigate = useNavigate();
  useBackDismiss(true, onClose);
  const type = eventTypes.find((t) => t.id === occ.typeId);
  const contact = contacts.find((c) => c.id === occ.contactId);
  const recurring = occ.repeat && occ.repeat !== 'none';
  const color = occ.color || type?.color;

  const directionsUrl =
    occ.locLat != null ? `https://www.google.com/maps/dir/?api=1&destination=${occ.locLat},${occ.locLng}` : null;

  const shareEvent = () => {
    if (!isPro) {
      navigate('/pricing');
      return;
    }
    alert('Inviting others to collaborate on an event needs an account backend, which is not connected in this build yet.');
  };

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

        <button className="btn btn-ghost full share-event-btn" onClick={shareEvent}>
          👥 Share event {!isPro && '· Pro'}
        </button>
      </div>
    </div>
  );
}

// --- Event editor (full-page sheet) -----------------------------------------

function EventEditor({ editing, events, contacts, eventTypes, settings, onClose, onSave, onDelete, onSkipOccurrence, setSettings, onSelectLocation }) {
  const [draft, setDraft] = useState(null);
  const [initialJson, setInitialJson] = useState('');
  const [scheduling, setScheduling] = useState(false);
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
    setScheduling(false);
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
      title={scheduling ? `Schedule — ${formatShortDate(draft.date)}` : editing.id ? 'Edit event' : 'New event'}
      dirty={dirty}
      onSave={doSave}
      onDiscard={onClose}
    >
      {scheduling ? (
        <ScheduleCalendarView
          draft={draft}
          setDraft={setDraft}
          events={events}
          eventTypes={eventTypes}
          settings={settings}
          onDone={() => setScheduling(false)}
        />
      ) : (
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
        <button type="button" className="btn btn-ghost full" onClick={() => setScheduling(true)}>
          📅 Schedule from calendar
        </button>

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
          </div>
          <div className="location-pick-row">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onSelectLocation(draft)}
            >
              📍 {draft.locLat != null ? 'Change location' : 'Select location'}
            </button>
            {draft.locLat != null && (
              <>
                <span className="muted small location-pick-coords">
                  {draft.locLat.toFixed(4)}, {draft.locLng.toFixed(4)}
                </span>
                <button
                  type="button"
                  className="btn btn-danger-ghost btn-sm"
                  onClick={() => setDraft({ ...draft, locLat: null, locLng: null })}
                >
                  Clear pin
                </button>
              </>
            )}
          </div>
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
      )}
    </EditorSheet>
  );
}

// --- Schedule-from-calendar: drag the draft event directly on the day timeline ---

const SCHED_PX_PER_HOUR = 64;

function ScheduleCalendarView({ draft, setDraft, events, eventTypes, settings, onDone }) {
  const bodyRef = useRef(null);
  const dragRef = useRef(null); // { mode, startClientY, startS, startE }
  const dayStart = settings?.timelineStartHour ?? DAY_START;
  const dayEnd = settings?.timelineEndHour ?? DAY_END;
  const pxPerHour = SCHED_PX_PER_HOUR;
  const pxPerMin = pxPerHour / 60;
  const typeColor = (id) => eventTypes.find((t) => t.id === id)?.color;

  const others = useMemo(
    () =>
      layout(
        occurrencesFor(events, draft.date).filter((e) => e.e2 > e.s && e.id !== draft.id)
      ),
    [events, draft.date, draft.id]
  );

  const s = timeToMinutes(draft.start);
  const e2 = Math.max(s + 15, timeToMinutes(draft.end));
  const hours = [];
  for (let h = dayStart; h <= dayEnd; h++) hours.push(h);

  const stepDay = (n) => setDraft({ ...draft, date: toISODate(addDays(draft.date, n)) });

  const commit = (nextS, nextE, snapRef) => {
    const snap = `${nextS}:${nextE}`;
    if (snapRef.current !== snap) {
      snapRef.current = snap;
      selectTick();
    }
    setDraft((d) => ({ ...d, start: minutesToTime(nextS), end: minutesToTime(nextE) }));
  };

  const onDown = (mode) => (e) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, startClientY: e.clientY, startS: s, startE: e2, snapRef: { current: null } };
    confirmTick();
  };
  const onMove = (e) => {
    const g = dragRef.current;
    if (!g) return;
    const dy = e.clientY - g.startClientY;
    const deltaMin = Math.round(dy / pxPerMin / 15) * 15;
    const minStart = dayStart * 60;
    const maxEnd = dayEnd * 60;
    if (g.mode === 'move') {
      const dur = g.startE - g.startS;
      let nextS = Math.max(minStart, Math.min(maxEnd - dur, g.startS + deltaMin));
      commit(nextS, nextS + dur, g.snapRef);
    } else if (g.mode === 'resize-top') {
      const nextS = Math.max(minStart, Math.min(g.startE - 15, g.startS + deltaMin));
      commit(nextS, g.startE, g.snapRef);
    } else if (g.mode === 'resize-bottom') {
      const nextE = Math.min(maxEnd, Math.max(g.startS + 15, g.startE + deltaMin));
      commit(g.startS, nextE, g.snapRef);
    }
  };
  const onUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    confirmTick();
  };

  const top = (s - dayStart * 60) * pxPerMin;
  const height = Math.max(28, (e2 - s) * pxPerMin);

  return (
    <div className="schedule-calendar">
      <div className="week-nav schedule-nav">
        <button className="icon-btn" onClick={() => stepDay(-1)} aria-label="Previous day">
          <Chevron dir="left" />
        </button>
        <span className="week-label">{formatDayLabel(draft.date)}</span>
        <button className="icon-btn" onClick={() => stepDay(1)} aria-label="Next day">
          <Chevron dir="right" />
        </button>
      </div>
      <p className="muted small center-pad">Drag the block to move it, or its top/bottom handles to resize.</p>
      <div className="timeline">
        <div className="timeline-body" ref={bodyRef} style={{ height: (dayEnd - dayStart + 1) * pxPerHour }}>
          {hours.map((h) => (
            <div className="hour-row" key={h} style={{ height: pxPerHour }}>
              <span className="hour-label">{formatTime(`${String(h).padStart(2, '0')}:00`)}</span>
              <div className="hour-line" />
            </div>
          ))}
          <div className="event-layer">
            {others.map((ev) => (
              <div
                key={`${ev.id}:${ev.recDate}`}
                className="event-block schedule-ghost-block"
                style={{
                  top: (ev.s - dayStart * 60) * pxPerMin,
                  height: Math.max(24, (ev.e2 - ev.s) * pxPerMin - 3),
                  left: `${(ev.col / ev.cols) * 100}%`,
                  width: `calc(${100 / ev.cols}% - 4px)`,
                  '--ev': ev.color || typeColor(ev.typeId) || 'var(--accent)',
                }}
              >
                <span className="event-title">{ev.title || 'Untitled'}</span>
              </div>
            ))}
            <div
              className="event-block schedule-draft-block"
              style={{ top, height, left: 0, width: 'calc(100% - 4px)', '--ev': draft.color || typeColor(draft.typeId) || 'var(--accent)' }}
              onPointerDown={onDown('move')}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <span className="event-time">
                {formatTime(minutesToTime(s))} – {formatTime(minutesToTime(e2))}
              </span>
              <span className="event-title">{draft.title || 'Untitled'}</span>
              <div
                className="schedule-handle schedule-handle--top"
                onPointerDown={onDown('resize-top')}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              />
              <div
                className="schedule-handle schedule-handle--bottom"
                onPointerDown={onDown('resize-bottom')}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              />
            </div>
          </div>
        </div>
      </div>
      <button className="btn btn-primary full schedule-done-btn" onClick={onDone}>
        Done
      </button>
    </div>
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

function TodayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="15" r="2.1" fill="currentColor" />
    </svg>
  );
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
