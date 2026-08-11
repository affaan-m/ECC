import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore, useActions } from '../data/store.jsx';
import EditorSheet from '../components/EditorSheet.jsx';
import ExpandableFab from '../components/ExpandableFab.jsx';
import Checkbox from '../components/Checkbox.jsx';
import ReorderToggleList from '../components/ReorderToggleList.jsx';
import SwipeToDelete from '../components/SwipeToDelete.jsx';
import SmartQuickAdd from '../components/SmartQuickAdd.jsx';
import { Brand } from '../components/Logo.jsx';
import {
  todayISO,
  weekKey,
  goalKey,
  formatTime,
  formatShortDate,
  expandEventOnDay,
  computeGoalStreak,
  addDays,
  toISODate,
} from '../data/helpers.js';
import { requestNotificationPermission, notificationsSupported } from '../data/notifications.js';
import { HOME_BLOCK_TYPES, normalizeHomeBlocks } from '../data/homeBlocks.js';
import { computeWeeklyRecap } from '../data/weeklyRecap.js';
import { computeNudges } from '../data/nudges.js';
import { useEdgeFade } from '../data/useEdgeFade.js';
import { useToast } from '../data/toast.jsx';
import { useCountUp } from '../data/useCountUp.js';
import { useSmartAdd } from '../data/useSmartAdd.js';
import AnimatedNumber from '../components/AnimatedNumber.jsx';
import Icon from '../components/Icon.jsx';
import AddressField from '../components/AddressField.jsx';

// Shown when every home block has been toggled off in Customize mode —
// picked once at random per visit rather than always the same line, since
// you might land on this blank screen more than once.
const EMPTY_HOME_MESSAGES = [
  "It's looking pretty empty in here.",
  'Tumbleweeds. Just tumbleweeds.',
  'This home screen is on a diet.',
  'Nothing to see here... all your tiles are hiding.',
  'Peak minimalism achieved.',
  'Your tiles took the day off.',
  'Home screen: still under construction (by you).',
  "It's quiet. Too quiet.",
];

// Fixed pale tints rather than theme colours — a tinted note forces dark
// text (see .note-card--tinted), so every swatch has to stay light enough to
// read against in either theme.
const NOTE_COLORS = [
  '',
  '#fdf2c9', // butter
  '#ffe3cc', // apricot
  '#ffd6d6', // coral
  '#ffe1e6', // pink
  '#f3e0ff', // violet
  '#e6e6fa', // lavender
  '#dceeff', // sky
  '#cfeef5', // cyan
  '#e1f3ee', // mint
  '#e4f7d4', // sage
  '#f0e9d8', // sand
  '#e6eaf0', // stone
];
const TASK_REMINDER_OFFSETS = [
  { mins: 15, label: '15 min before' },
  { mins: 30, label: '30 min before' },
  { mins: 60, label: '1 hour before' },
];

export default function HomePage() {
  const { state } = useStore();
  const actions = useActions();
  const navigate = useNavigate();
  const location = useLocation();
  const showToast = useToast();
  const isPro = !!state.settings?.isPro;
  const taskCompleteAnim = state.settings?.taskCompleteAnim ?? true;
  const [editMode, setEditMode] = useState(false);
  const [smartAddOpen, setSmartAddOpen] = useState(false);
  const taskSwipeRefs = useRef(new Map());

  // A delete is reversible for a few seconds instead of instant and silent —
  // the add actions preserve the original id when it's included in the
  // passed-in data, so undo just re-adds the exact same object back.
  const deleteTaskWithUndo = (t) => {
    actions.deleteTask(t.id);
    showToast(`"${t.title || 'Task'}" deleted`, 'Undo', () => actions.addTask(t));
  };
  // Checking a task off happens in two beats rather than one.
  //
  // It used to be one: the tap set done, the list re-sorted in the same
  // frame, and the row you had your finger on vanished and reappeared at the
  // bottom. You never saw the check land — the confirmation animation played
  // somewhere else on the screen, on a row that had already moved.
  //
  // So the row is held where it is while the check and its sparkles play
  // (POP_MS), then slides away (FILE_MS) and joins the Done group at the
  // bottom. The two phases are separate sets because they mean different
  // things to the row: the first says "still here, now ticked", the second
  // says "leaving".
  //
  // This also covers the case the flash was originally written for: a
  // repeating task resets to unchecked in the very same update (see
  // toggleTaskDone), so without the pop it would never visibly render
  // checked at all and the tap would look like it did nothing.
  const POP_MS = 500;
  const FILE_MS = 260;
  const [justCompletedIds, setJustCompletedIds] = useState(new Set());
  const [filingIds, setFilingIds] = useState(new Set());
  const completionTimers = useRef(new Map());
  const withoutId = (id) => (prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  };
  const cancelCompletion = (id) => {
    for (const t of completionTimers.current.get(id) || []) clearTimeout(t);
    completionTimers.current.delete(id);
    setJustCompletedIds(withoutId(id));
    setFilingIds(withoutId(id));
  };
  const flashCompleted = (id) => {
    cancelCompletion(id);
    setJustCompletedIds((prev) => new Set(prev).add(id));
    completionTimers.current.set(id, [
      setTimeout(() => {
        setJustCompletedIds(withoutId(id));
        setFilingIds((prev) => new Set(prev).add(id));
      }, POP_MS),
      setTimeout(() => {
        setFilingIds(withoutId(id));
        completionTimers.current.delete(id);
      }, POP_MS + FILE_MS),
    ]);
  };
  // Leaving the page mid-animation would otherwise fire setState on an
  // unmounted component and, worse, strand the row's "leaving" class.
  useEffect(
    () => () => {
      for (const timers of completionTimers.current.values()) timers.forEach(clearTimeout);
      completionTimers.current.clear();
    },
    []
  );
  // Checking off a plain task just marks it done, same as always. Checking
  // off a repeating one instead rolls its due date forward and resets done
  // to false, so it comes back for its next occurrence instead of sitting
  // done forever — both cases log the date to completedDates for the
  // weekly recap. Un-checking (done -> not done) never repeats forward or
  // logs anything; it's just undoing a mistaken tap.
  const toggleTaskDone = (t) => {
    if (t.done) {
      // Pulling one back out of Done: cancel any animation still queued for
      // it, or the row would arrive in the open list already fading away.
      cancelCompletion(t.id);
      actions.updateTask({ ...t, done: false });
      return;
    }
    flashCompleted(t.id);
    const completedDates = [...(t.completedDates || []), todayISO()];
    if (t.repeat && t.repeat !== 'none' && t.dueDate) {
      const nextDueDate = toISODate(addDays(t.dueDate, t.repeat === 'weekly' ? 7 : 1));
      actions.updateTask({ ...t, done: false, dueDate: nextDueDate, completedDates });
    } else {
      actions.updateTask({ ...t, done: true, completedDates });
    }
  };
  const smartAdd = useSmartAdd(todayISO());
  const createFromSmartAdd = (kind, parsed) => {
    smartAdd(kind, parsed);
    setSmartAddOpen(false);
  };
  const deleteNoteWithUndo = (n) => {
    actions.deleteNote(n.id);
    showToast(`"${n.title || 'Note'}" deleted`, 'Undo', () => actions.addNote(n));
  };

  // Reached via the expandable quick-add FAB on another page (e.g. Planner),
  // or from a search result for a task/note.
  useEffect(() => {
    if (location.state?.quickNewTask) {
      openNewTask();
      window.history.replaceState({}, '');
    } else if (location.state?.quickNewNote) {
      openNewNote();
      window.history.replaceState({}, '');
    } else if (location.state?.openTaskId) {
      const t = state.tasks.find((x) => x.id === location.state.openTaskId);
      if (t) openEditTask(t);
      window.history.replaceState({}, '');
    } else if (location.state?.openNoteId) {
      const n = state.notes.find((x) => x.id === location.state.openNoteId);
      if (n) openEditNote(n);
      window.history.replaceState({}, '');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayISO();
  const dailyKey = goalKey('daily', new Date());
  const weeklyKey = goalKey('weekly', new Date());
  const todayDow = new Date().getDay();
  const dailyGoals = state.goals.filter(
    (g) => (g.period || 'weekly') === 'daily' && (!g.repeatDays?.length || g.repeatDays.includes(todayDow))
  );
  const weeklyGoals = state.goals.filter((g) => (g.period || 'weekly') === 'weekly');

  const ringPct = (goals, key) => {
    if (goals.length === 0) return 0;
    const target = goals.reduce((s, g) => s + (g.target || 0), 0);
    const done = goals.reduce((s, g) => s + Math.min(g.progress?.[key] || 0, g.target || 0), 0);
    return target ? Math.round((done / target) * 100) : 0;
  };
  const dailyPct = ringPct(dailyGoals, dailyKey);
  const weeklyPct = ringPct(weeklyGoals, weekKey(new Date()));
  // Best current streak across every goal — the single most eye-catching
  // number to lead with on the page people actually open every day.
  const bestStreak = state.goals.reduce((max, g) => Math.max(max, computeGoalStreak(g)), 0);

  // "Important reminders": anything with a reminder firing today that isn't
  // done yet — goals, tasks, and today's events (including recurring ones,
  // and regardless of whether a reminder lead time is set — any event
  // happening today is worth surfacing here, not just ones with a reminder).
  const reminders = useMemo(() => {
    const out = [];
    for (const g of state.goals) {
      if (!g.reminder?.time) continue;
      const isDaily = (g.period || 'weekly') === 'daily';
      if (isDaily && g.repeatDays?.length && !g.repeatDays.includes(todayDow)) continue;
      const key = isDaily ? today : weekKey(new Date());
      if ((g.progress?.[key] || 0) >= g.target) continue;
      out.push({ kind: 'goal', id: g.id, label: g.title, time: g.reminder.time });
    }
    for (const t of state.tasks || []) {
      if (t.done || t.dueDate !== today) continue;
      out.push({ kind: 'task', id: t.id, label: t.title, time: t.dueTime || null });
    }
    for (const e of state.events) {
      for (const occ of expandEventOnDay(e, today)) {
        if (!occ.done) out.push({ kind: 'event', id: `${occ.id}:${occ.recDate}`, label: occ.title, time: occ.start });
      }
    }
    return out.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')).slice(0, 6);
  }, [state.goals, state.tasks, state.events, today]);

  // --- Tasks ---
  const [newTaskText, setNewTaskText] = useState('');
  const [editingTask, setEditingTask] = useState(null);
  const initialTaskJson = useRef('');
  const reminderChipsRef = useRef(null);
  const reminderChipsFade = useEdgeFade(reminderChipsRef, [editingTask?.id]);
  // Two lists, not one sorted list. What's left to do stays at the top in
  // the order it was added; what's finished collects at the bottom under a
  // count you can fold away, so a productive week doesn't bury tomorrow's
  // three tasks under thirty ticked ones.
  //
  // A task mid-animation counts as open no matter what `done` says — that's
  // what holds it under your finger until the check has landed.
  const [showDone, setShowDone] = useState(false);
  const { openTasks, doneTasks } = useMemo(() => {
    const settling = (t) => justCompletedIds.has(t.id) || filingIds.has(t.id);
    const open = [];
    const done = [];
    for (const t of state.tasks || []) (t.done && !settling(t) ? done : open).push(t);
    // Most recently finished first: the one you're most likely to have
    // ticked by mistake is the one at the top of the fold-out.
    done.sort((a, b) => lastCompleted(b).localeCompare(lastCompleted(a)));
    return { openTasks: open, doneTasks: done };
  }, [state.tasks, justCompletedIds, filingIds]);

  const clearDoneTasks = () => {
    const removed = doneTasks;
    if (removed.length === 0) return;
    for (const t of removed) actions.deleteTask(t.id);
    setShowDone(false);
    showToast(
      `Cleared ${removed.length} finished task${removed.length === 1 ? '' : 's'}`,
      'Undo',
      () => {
        for (const t of removed) actions.addTask(t);
      }
    );
  };
  const openNewTask = () => {
    const d = {
      title: newTaskText.trim(),
      notes: '',
      location: '',
      dueDate: '',
      dueTime: '',
      reminderOffsets: [],
      repeat: 'none',
      subtasks: [],
    };
    setEditingTask(d);
    initialTaskJson.current = JSON.stringify(d);
    setNewTaskText('');
  };
  const openEditTask = (t) => {
    const d = {
      ...t,
      notes: t.notes || '',
      location: t.location || '',
      dueDate: t.dueDate || '',
      dueTime: t.dueTime || '',
      reminderOffsets: t.reminderOffsets || [],
      repeat: t.repeat || 'none',
      subtasks: t.subtasks || [],
    };
    setEditingTask(d);
    initialTaskJson.current = JSON.stringify(d);
  };
  const addTaskSubtask = () =>
    setEditingTask((t) => ({ ...t, subtasks: [...(t.subtasks || []), { text: '', done: false }] }));
  // Tracks which tasks have their subtask checklist expanded on the row
  // itself — separate from the edit sheet, so ticking off "pack passport"
  // doesn't require opening the full editor first.
  const [expandedTaskIds, setExpandedTaskIds] = useState(new Set());
  const toggleTaskExpanded = (id) =>
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleSubtaskDone = (task, i) => {
    const subtasks = task.subtasks.slice();
    subtasks[i] = { ...subtasks[i], done: !subtasks[i].done };
    actions.updateTask({ ...task, subtasks });
  };

  // One row, rendered into either group — extracted when the list split in
  // two so the open and Done halves can't drift apart.
  const renderTaskRow = (t) => (
    <li key={t.id} className={filingIds.has(t.id) ? 'task-filing' : undefined}>
      <SwipeToDelete
        ref={(el) => {
          if (el) taskSwipeRefs.current.set(t.id, el);
          else taskSwipeRefs.current.delete(t.id);
        }}
        onDelete={() => deleteTaskWithUndo(t)}
      >
        <div className="task-row">
          <button
            // --on tracks the persistent done state; --pop is only ever the
            // transient just-completed flash. Keying --pop off t.done as well
            // meant a CSS animation sat on every already-done task, and those
            // replay whenever the element mounts — so the whole list
            // celebrated again on every visit to Home. flashCompleted() runs
            // for plain and repeating tasks alike, so this loses nothing.
            className={`task-check${t.done || justCompletedIds.has(t.id) ? ' task-check--on' : ''}${justCompletedIds.has(t.id) && taskCompleteAnim ? ' task-check--pop' : ''}`}
            data-haptic={t.done ? 'tap' : 'confirm'}
            onClick={() => toggleTaskDone(t)}
            aria-label={t.done ? 'Mark not done' : 'Mark done'}
          >
            {(t.done || justCompletedIds.has(t.id)) && <CheckIcon />}
            <span className="task-check-sparkles" aria-hidden="true">
              <i /><i /><i /><i /><i /><i />
            </span>
          </button>
          <button className="task-title-btn" onClick={() => openEditTask(t)}>
            <span className={`task-title${t.done ? ' task-title--done' : ''}`}>
              {t.title}
              {t.repeat && t.repeat !== 'none' && <span className="repeat-glyph"> <Icon name="repeat" size={13} /></span>}
            </span>
            {(t.location || t.dueDate) && !t.done && (
              <span className="task-meta muted small">
                {[t.location, t.dueDate && formatShortDate(t.dueDate)].filter(Boolean).join(' · ')}
              </span>
            )}
          </button>
          {t.dueTime && !t.done && <span className="reminder-time">{formatTime(t.dueTime)}</span>}
          {(t.subtasks || []).length > 0 && (
            <button
              className={`subtask-badge${expandedTaskIds.has(t.id) ? ' subtask-badge--open' : ''}`}
              onClick={() => toggleTaskExpanded(t.id)}
              aria-label={expandedTaskIds.has(t.id) ? 'Hide subtasks' : 'Show subtasks'}
            >
              {t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}
            </button>
          )}
          <button
            className="icon-btn task-del"
            onClick={() => taskSwipeRefs.current.get(t.id)?.remove()}
            aria-label="Delete task"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </SwipeToDelete>
      {/* Quick-check without opening the full editor — outside SwipeToDelete
          so its own swipe-gesture measurement of the row above is never
          affected by this being open or closed. */}
      {(t.subtasks || []).length > 0 && expandedTaskIds.has(t.id) && (
        <ul className="subtask-list">
          {t.subtasks.map((s, i) => (
            <li key={i} className="subtask-row">
              <button
                className={`task-check task-check--sm${s.done ? ' task-check--on' : ''}`}
                data-haptic={s.done ? 'tap' : 'confirm'}
                onClick={() => toggleSubtaskDone(t, i)}
                aria-label={s.done ? 'Mark not done' : 'Mark done'}
              >
                {s.done && <CheckIcon />}
              </button>
              <span className={`subtask-text${s.done ? ' subtask-text--done' : ''}`}>{s.text}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
  const taskDirty = editingTask ? JSON.stringify(editingTask) !== initialTaskJson.current : false;
  const toggleTaskReminderOffset = (mins) => {
    setEditingTask((t) => ({
      ...t,
      reminderOffsets: t.reminderOffsets.includes(mins)
        ? t.reminderOffsets.filter((m) => m !== mins)
        : [...t.reminderOffsets, mins],
    }));
  };
  const saveTask = async () => {
    const title = editingTask.title.trim();
    if (!title) return setEditingTask(null);
    // A "before due" reminder needs a due date+time to count back from.
    const canRemind = !!(editingTask.dueDate && editingTask.dueTime);
    const reminderOffsets = canRemind ? editingTask.reminderOffsets : [];
    if (reminderOffsets.length > 0) {
      await requestNotificationPermission();
      actions.setSettings({ notifications: true });
    }
    const payload = {
      title,
      notes: editingTask.notes.trim(),
      location: editingTask.location.trim(),
      dueDate: editingTask.dueDate,
      dueTime: editingTask.dueTime,
      reminderOffsets,
      // A repeating task needs an anchor date to advance from each time
      // it's checked off — without one "repeats" would have nothing to
      // count forward from, so it's meaningless.
      repeat: editingTask.dueDate ? editingTask.repeat || 'none' : 'none',
      // Blank rows left over from "+ Add subtask" don't survive a save —
      // same reasoning as the title itself needing to be non-empty.
      subtasks: (editingTask.subtasks || [])
        .map((s) => ({ ...s, text: s.text.trim() }))
        .filter((s) => s.text),
    };
    if (editingTask.id) actions.updateTask({ ...editingTask, ...payload });
    else actions.addTask({ ...payload, createdAt: today });
    setEditingTask(null);
  };

  // --- Notes ---
  const [editingNote, setEditingNote] = useState(null);
  const initialNoteJson = useRef('');
  const [poppedChecklistIdx, setPoppedChecklistIdx] = useState(null);
  const checklistPopTimer = useRef(null);
  useEffect(() => () => clearTimeout(checklistPopTimer.current), []);
  // Notes written from a contact's timeline carry a contactId and belong to
  // that contact only — Home's notes bar is for general, unattached notes.
  const notes = useMemo(
    () => (state.notes || []).filter((n) => !n.contactId).sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    [state.notes]
  );
  const openNewNote = () => {
    const d = { title: '', body: '', checklist: null, color: '', pinned: false };
    setEditingNote(d);
    initialNoteJson.current = JSON.stringify(d);
  };
  const openEditNote = (n) => {
    setEditingNote({ ...n });
    initialNoteJson.current = JSON.stringify(n);
  };
  const noteDirty = editingNote ? JSON.stringify(editingNote) !== initialNoteJson.current : false;
  const saveNote = () => {
    if (!editingNote.title.trim() && !editingNote.body.trim() && !(editingNote.checklist || []).length) {
      setEditingNote(null);
      return;
    }
    const payload = { ...editingNote, updatedAt: today };
    if (editingNote.id) actions.updateNote(payload);
    else actions.addNote({ ...payload, createdAt: today });
    setEditingNote(null);
  };
  const toggleChecklist = (checked) => {
    setEditingNote((n) => ({ ...n, checklist: checked ? [] : null }));
  };
  const addChecklistItem = () => {
    setEditingNote((n) => ({ ...n, checklist: [...(n.checklist || []), { text: '', done: false }] }));
  };

  // --- Home blocks (Pro: reorder + show/hide, editable right here) ---
  const homeBlocks = useMemo(
    () => normalizeHomeBlocks(state.settings?.homeBlocks),
    [state.settings?.homeBlocks]
  );
  const visibleBlocks = useMemo(() => homeBlocks.filter((b) => b.enabled), [homeBlocks]);
  const emptyHomeMessage = useMemo(
    () => EMPTY_HOME_MESSAGES[Math.floor(Math.random() * EMPTY_HOME_MESSAGES.length)],
    []
  );
  const recap = useMemo(() => computeWeeklyRecap(state), [state]);
  const nudges = useMemo(() => computeNudges(state), [state]);

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-row">
          <Brand>Home</Brand>
          <div className="page-head-actions">
            {!isPro && (
              <button className="pro-bubble" onClick={() => navigate('/pricing')}>
                <CrownIcon /> Pro
              </button>
            )}
            <button className="icon-btn" onClick={() => navigate('/search')} aria-label="Search" title="Search">
              <SearchIcon />
            </button>
            <button
              className="icon-btn"
              onClick={() => (isPro ? setEditMode((v) => !v) : navigate('/pricing'))}
              aria-label={editMode ? 'Done editing home screen' : 'Edit home screen'}
              title={editMode ? 'Done' : 'Edit home screen'}
            >
              {editMode ? <CheckIcon /> : <PencilIcon />}
            </button>
          </div>
        </div>
      </header>

      {editMode ? (
        <section className="detail-section">
          <span className="detail-label">Customize home screen</span>
          <p className="muted small">Drag to reorder, toggle off to hide. Tap Done above when finished.</p>
          <ReorderToggleList
            items={homeBlocks}
            types={HOME_BLOCK_TYPES}
            onChange={(next) => actions.setSettings({ homeBlocks: next })}
          />
        </section>
      ) : visibleBlocks.length === 0 ? (
        <p className="muted center-pad">{emptyHomeMessage}</p>
      ) : (
        visibleBlocks.map((b) => {
          if (b.id === 'goals') {
            return (
              <button key="goals" className="detail-section home-block-goals" onClick={() => navigate('/goals')}>
                <div className="goals-block-head">
                  <span className="detail-label"><Icon name="target" /> Goals</span>
                  {bestStreak >= 2 && (
                    <span className="streak-badge">
                      <Icon name="flame" size={16} /> <AnimatedNumber value={bestStreak} />
                    </span>
                  )}
                </div>
                <div className="home-bubble-rings">
                  <MiniRing pct={dailyPct} label="Today" />
                  <MiniRing pct={weeklyPct} label="Week" />
                </div>
              </button>
            );
          }
          if (b.id === 'nudges') {
            if (nudges.length === 0) return null;
            return (
              <section className="detail-section" key="nudges">
                <span className="detail-label"><Icon name="lightbulb" /> Nudges</span>
                <ul className="nudge-list">
                  {nudges.map((n) => (
                    <li key={n.id}>
                      <button className="nudge-row" onClick={() => navigate(n.to)}>
                        <span className="nudge-icon" aria-hidden="true"><Icon name={n.icon} size={18} /></span>
                        <span className="nudge-text">{n.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          }
          if (b.id === 'recap') {
            const nothingYet =
              recap.goalsCompleted === 0 && recap.contactsReconnected === 0 && recap.tasksCompleted === 0;
            if (nothingYet) return null;
            return (
              <section className="detail-section recap-block" key="recap">
                <span className="detail-label"><Icon name="chart" /> This week</span>
                <div className="recap-stats">
                  <div className="recap-stat">
                    <strong>
                      <AnimatedNumber value={recap.goalsCompleted} />
                      {recap.goalsPossible > 0 && <span className="recap-of">/{recap.goalsPossible}</span>}
                    </strong>
                    <span className="muted small">Goals hit</span>
                  </div>
                  <div className="recap-stat">
                    <strong>
                      <AnimatedNumber value={recap.tasksCompleted} />
                    </strong>
                    <span className="muted small">Tasks done</span>
                  </div>
                  <div className="recap-stat">
                    <strong>
                      <AnimatedNumber value={recap.contactsReconnected} />
                    </strong>
                    <span className="muted small">People reconnected</span>
                  </div>
                </div>
              </section>
            );
          }
          if (b.id === 'reminders') {
            if (reminders.length === 0) return null;
            return (
              <section className="detail-section" key="reminders">
                <span className="detail-label"><Icon name="bell" /> Important reminders</span>
                <ul className="reminder-list">
                  {reminders.map((r) => (
                    <li key={`${r.kind}:${r.id}`}>
                      <button
                        className="reminder-row"
                        onClick={() => {
                          if (r.kind === 'goal') navigate('/goals');
                          else if (r.kind === 'event') navigate('/planner');
                        }}
                      >
                        <span className={`reminder-kind reminder-kind--${r.kind}`}>{r.kind}</span>
                        <span className="reminder-label">{r.label}</span>
                        {r.time && <span className="reminder-time">{formatTime(r.time)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          }
          if (b.id === 'tasks') {
            return (
              <section className="detail-section" key="tasks">
                <span className="detail-label">Tasks</span>
                <ul className="task-list">
                  {openTasks.map(renderTaskRow)}
                  {openTasks.length === 0 && doneTasks.length === 0 && (
                    <li className="muted small">No tasks yet.</li>
                  )}
                  {openTasks.length === 0 && doneTasks.length > 0 && (
                    <li className="muted small">All done.</li>
                  )}
                  {/* Finished work, folded away. Kept in the same list rather
                      than a separate section so unfolding it reads as the
                      list continuing, and a mis-tick is one tap from being
                      undone. */}
                  {doneTasks.length > 0 && (
                    <li className="task-done-head">
                      <button
                        className={`task-done-toggle${showDone ? ' task-done-toggle--open' : ''}`}
                        onClick={() => setShowDone((v) => !v)}
                        aria-expanded={showDone}
                      >
                        <Icon name="chevronDown" size={15} />
                        Done · {doneTasks.length}
                      </button>
                      <button className="task-done-clear" onClick={clearDoneTasks}>
                        Clear
                      </button>
                    </li>
                  )}
                  {showDone && doneTasks.map(renderTaskRow)}
                </ul>
                <div className="task-add-row">
                  <input
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && openNewTask()}
                    placeholder="Add a task…"
                  />
                  <button className="btn btn-primary btn-sm" onClick={openNewTask}>
                    Add
                  </button>
                </div>
              </section>
            );
          }
          if (b.id === 'notes') {
            return (
              <section className="detail-section" key="notes">
                <div className="section-head">
                  <span className="detail-label"><Icon name="note" /> Notes</span>
                  <button className="btn btn-ghost btn-sm" onClick={openNewNote}>
                    + Add
                  </button>
                </div>
                {notes.length === 0 ? (
                  <p className="muted small">No notes yet.</p>
                ) : (
                  <div className="notes-grid">
                    {notes.map((n) => (
                      <button
                        key={n.id}
                        className={`note-card${n.color ? ' note-card--tinted' : ''}`}
                        style={n.color ? { background: n.color } : undefined}
                        onClick={() => openEditNote(n)}
                      >
                        {n.pinned && <span className="note-pin"><Icon name="bookmark" size={14} /></span>}
                        {n.title && <strong className="note-title">{n.title}</strong>}
                        {n.checklist ? (
                          <ul className="note-checklist">
                            {n.checklist.slice(0, 5).map((item, i) => (
                              <li key={i} className={item.done ? 'note-check--done' : ''}>
                                <span className={`note-check-box${item.done ? ' note-check-box--on' : ''}`}>
                                  {item.done ? <Icon name="check" size={12} /> : null}
                                </span>
                                {item.text || 'Item'}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="note-body">{n.body}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            );
          }
          return null;
        })
      )}

      <ExpandableFab
        onAction={(id) => {
          if (id === 'event') navigate('/planner', { state: { quickNewEvent: true } });
          else if (id === 'contact') navigate('/contacts', { state: { quickNewContact: true } });
          else if (id === 'task') openNewTask();
          else if (id === 'note') openNewNote();
          else if (id === 'smart') (isPro ? setSmartAddOpen(true) : navigate('/pricing'));
        }}
      />

      <SmartQuickAdd
        open={smartAddOpen}
        onClose={() => setSmartAddOpen(false)}
        onCreate={createFromSmartAdd}
      />

      <EditorSheet
        open={!!editingNote}
        title={editingNote?.id ? 'Edit note' : 'New note'}
        dirty={noteDirty}
        onSave={saveNote}
        onDiscard={() => setEditingNote(null)}
        danger={
          editingNote?.id
            ? { label: 'Delete note', onClick: () => { deleteNoteWithUndo(editingNote); setEditingNote(null); } }
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
                placeholder="Optional"
              />
            </label>

            <label className="check-row">
              <Checkbox
                checked={!!editingNote.checklist}
                onChange={(e) => toggleChecklist(e.target.checked)}
                ariaLabel="Checklist"
              />
              <span>Checklist</span>
            </label>

            {editingNote.checklist ? (
              <div className="field">
                {editingNote.checklist.map((item, i) => (
                  <div className="checklist-row" key={i}>
                    <button
                      type="button"
                      className={`task-check${item.done ? ' task-check--on' : ''}${poppedChecklistIdx === i ? ' task-check--pop' : ''}`}
                      data-haptic={item.done ? 'tap' : 'confirm'}
                      onClick={() => {
                        const next = editingNote.checklist.slice();
                        const nowDone = !next[i].done;
                        next[i] = { ...next[i], done: nowDone };
                        setEditingNote({ ...editingNote, checklist: next });
                        clearTimeout(checklistPopTimer.current);
                        if (nowDone) {
                          setPoppedChecklistIdx(i);
                          checklistPopTimer.current = setTimeout(() => setPoppedChecklistIdx(null), 500);
                        } else {
                          setPoppedChecklistIdx(null);
                        }
                      }}
                    >
                      {item.done && <CheckIcon />}
                      <span className="task-check-sparkles" aria-hidden="true">
                        <i /><i /><i /><i /><i /><i />
                      </span>
                    </button>
                    <input
                      value={item.text}
                      onChange={(e) => {
                        const next = editingNote.checklist.slice();
                        next[i] = { ...next[i], text: e.target.value };
                        setEditingNote({ ...editingNote, checklist: next });
                      }}
                      placeholder="List item"
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => {
                        const next = editingNote.checklist.filter((_, idx) => idx !== i);
                        setEditingNote({ ...editingNote, checklist: next });
                      }}
                      aria-label="Remove item"
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                ))}
                <button type="button" className="btn btn-ghost btn-sm" onClick={addChecklistItem}>
                  + Add item
                </button>
              </div>
            ) : (
              <label className="field">
                <span>Note</span>
                <textarea
                  rows="6"
                  value={editingNote.body}
                  onChange={(e) => setEditingNote({ ...editingNote, body: e.target.value })}
                  placeholder="Write something…"
                />
              </label>
            )}

            <div className="field">
              <span>Color</span>
              <div className="color-grid note-color-grid">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c || 'none'}
                    type="button"
                    className={`color-dot${!c ? ' color-dot--clear' : ''}${editingNote.color === c ? ' color-dot--on' : ''}`}
                    style={c ? { background: c } : undefined}
                    onClick={() => setEditingNote({ ...editingNote, color: c })}
                  >
                    {!c && <Icon name="close" size={15} />}
                  </button>
                ))}
              </div>
            </div>

            <label className="check-row">
              <Checkbox
                checked={!!editingNote.pinned}
                onChange={(e) => setEditingNote({ ...editingNote, pinned: e.target.checked })}
                ariaLabel="Pin to top"
              />
              <span>Pin to top</span>
            </label>
          </div>
        )}
      </EditorSheet>

      <EditorSheet
        open={!!editingTask}
        title={editingTask?.id ? 'Edit task' : 'New task'}
        dirty={taskDirty}
        onSave={saveTask}
        onDiscard={() => setEditingTask(null)}
        danger={
          editingTask?.id
            ? { label: 'Delete task', onClick: () => { deleteTaskWithUndo(editingTask); setEditingTask(null); } }
            : undefined
        }
      >
        {editingTask && (
          <div className="form">
            <label className="field">
              <span>Task</span>
              <input
                value={editingTask.title}
                onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                placeholder="What needs doing?"
              />
            </label>
            <div className="field">
              <span>Subtasks</span>
              {(editingTask.subtasks || []).map((item, i) => (
                <div className="checklist-row" key={i}>
                  <button
                    type="button"
                    className={`task-check${item.done ? ' task-check--on' : ''}`}
                    data-haptic={item.done ? 'tap' : 'confirm'}
                    onClick={() => {
                      const next = editingTask.subtasks.slice();
                      next[i] = { ...next[i], done: !next[i].done };
                      setEditingTask({ ...editingTask, subtasks: next });
                    }}
                    aria-label={item.done ? 'Mark not done' : 'Mark done'}
                  >
                    {item.done && <CheckIcon />}
                    <span className="task-check-sparkles" aria-hidden="true">
                      <i /><i /><i /><i /><i /><i />
                    </span>
                  </button>
                  <input
                    value={item.text}
                    onChange={(e) => {
                      const next = editingTask.subtasks.slice();
                      next[i] = { ...next[i], text: e.target.value };
                      setEditingTask({ ...editingTask, subtasks: next });
                    }}
                    placeholder="Subtask"
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => {
                      const next = editingTask.subtasks.filter((_, idx) => idx !== i);
                      setEditingTask({ ...editingTask, subtasks: next });
                    }}
                    aria-label="Remove subtask"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={addTaskSubtask}>
                + Add subtask
              </button>
            </div>
            <div className="field">
              <span>Location</span>
              <AddressField
                value={editingTask.location}
                placeholder="Optional"
                onChange={(text) => setEditingTask({ ...editingTask, location: text })}
              />
            </div>
            <div className="field-row">
              <label className="field">
                <span>Due date</span>
                <input
                  type="date"
                  value={editingTask.dueDate}
                  onChange={(e) => setEditingTask({ ...editingTask, dueDate: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Due time</span>
                <input
                  type="time"
                  value={editingTask.dueTime}
                  onChange={(e) => setEditingTask({ ...editingTask, dueTime: e.target.value })}
                />
              </label>
            </div>
            {editingTask.dueDate && editingTask.dueTime && (
              <p className="muted small">Shows on the Planner calendar at that time.</p>
            )}
            {editingTask.dueDate && (
              <div className="field">
                <span>Repeats</span>
                <div className="seg seg--full">
                  {[
                    { value: 'none', label: 'Never' },
                    { value: 'daily', label: 'Daily' },
                    { value: 'weekly', label: 'Weekly' },
                  ].map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      className={`seg-btn${(editingTask.repeat || 'none') === o.value ? ' seg-btn--on' : ''}`}
                      onClick={() => setEditingTask({ ...editingTask, repeat: o.value })}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {editingTask.repeat && editingTask.repeat !== 'none' && (
                  <p className="muted small">
                    Checking it off moves the due date forward instead of leaving it done for good.
                  </p>
                )}
              </div>
            )}
            <label className="field">
              <span>Notes</span>
              <textarea
                rows="4"
                value={editingTask.notes}
                onChange={(e) => setEditingTask({ ...editingTask, notes: e.target.value })}
                placeholder="Any details…"
              />
            </label>
            {editingTask.dueDate && editingTask.dueTime && (
              <div className="field">
                <span>Remind me</span>
                <div
                  ref={reminderChipsRef}
                  className={`chips${reminderChipsFade.left ? ' chips--fade-left' : ''}${reminderChipsFade.right ? ' chips--fade-right' : ''}`}
                >
                  {TASK_REMINDER_OFFSETS.map((o) => (
                    <button
                      key={o.mins}
                      type="button"
                      className={`chip${editingTask.reminderOffsets.includes(o.mins) ? ' chip--on' : ''}`}
                      onClick={() => toggleTaskReminderOffset(o.mins)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {editingTask.reminderOffsets.length > 0 && !notificationsSupported() && (
                  <span className="muted small">This browser can't show notifications.</span>
                )}
              </div>
            )}
          </div>
        )}
      </EditorSheet>
    </div>
  );
}

// When a task was last ticked off. `completedDates` is appended to in order,
// so the last entry is the most recent; a task finished before the field
// existed sorts to the bottom, which is where the oldest belong anyway.
function lastCompleted(t) {
  const dates = t.completedDates || [];
  return dates.length ? dates[dates.length - 1] : '';
}

function MiniRing({ pct, label }) {
  const shown = useCountUp(pct);
  // Same two-stop sweep as the big ring on the Goals page (see ringStyle
  // there) — this is the smaller version of the identical widget, and a
  // flat single-color arc here while the other one has depth would read as
  // an oversight rather than a deliberate smaller variant.
  return (
    <div className="mini-ring-wrap">
      <div
        className="mini-ring"
        style={{
          background: `conic-gradient(from -90deg, var(--ring-hi) 0deg, var(--accent) ${shown * 3.6}deg, var(--track) ${shown * 3.6}deg)`,
        }}
      >
        <span>{shown}%</span>
      </div>
      <span className="mini-ring-label">{label}</span>
    </div>
  );
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M3 8l4 3 5-6 5 6 4-3-1.5 10h-15L3 8z"
        fill="currentColor"
      />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-4.3-4.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M4 12l5 5 11-11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
