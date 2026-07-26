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
import { useToast } from '../data/toast.jsx';
import { useCountUp } from '../data/useCountUp.js';
import AnimatedNumber from '../components/AnimatedNumber.jsx';

const NOTE_COLORS = ['', '#fdf2c9', '#e1f3ee', '#e6e6fa', '#ffe1e6', '#dceeff'];
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
  // A repeating task's checkbox resets to unchecked in the very same update
  // (see toggleTaskDone below), so without this it would never visibly
  // render "checked" — the tap would look like it did nothing. Flashing the
  // checked/pop state locally for a beat gives the same "done!" confirmation
  // a normal task gets, before the row settles back to its next occurrence.
  const [justCompletedIds, setJustCompletedIds] = useState(new Set());
  const flashCompleted = (id) => {
    setJustCompletedIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setJustCompletedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 500);
  };
  // Checking off a plain task just marks it done, same as always. Checking
  // off a repeating one instead rolls its due date forward and resets done
  // to false, so it comes back for its next occurrence instead of sitting
  // done forever — both cases log the date to completedDates for the
  // weekly recap. Un-checking (done -> not done) never repeats forward or
  // logs anything; it's just undoing a mistaken tap.
  const toggleTaskDone = (t) => {
    if (t.done) {
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
  const createFromSmartAdd = (kind, parsed) => {
    if (kind === 'event') {
      const start = parsed.time || '09:00';
      const [h, m] = start.split(':').map(Number);
      const endMins = Math.min(23 * 60 + 59, h * 60 + m + 60);
      const end = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
      actions.addEvent({
        title: parsed.title,
        date: parsed.date || todayISO(),
        start,
        end,
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
      });
      showToast(`"${parsed.title}" added to your calendar`);
    } else {
      actions.addTask({
        title: parsed.title,
        notes: '',
        location: '',
        dueDate: parsed.date || '',
        dueTime: parsed.time || '',
        reminderOffsets: [],
      });
      showToast(`"${parsed.title}" added to your tasks`);
    }
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
  const tasks = useMemo(
    () => [...(state.tasks || [])].sort((a, b) => Number(a.done) - Number(b.done)),
    [state.tasks]
  );
  const openNewTask = () => {
    const d = {
      title: newTaskText.trim(),
      notes: '',
      location: '',
      dueDate: '',
      dueTime: '',
      reminderOffsets: [],
      repeat: 'none',
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
    };
    setEditingTask(d);
    initialTaskJson.current = JSON.stringify(d);
  };
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
  const recap = useMemo(() => computeWeeklyRecap(state), [state]);

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
      ) : (
        visibleBlocks.map((b) => {
          if (b.id === 'goals') {
            return (
              <button key="goals" className="detail-section home-block-goals" onClick={() => navigate('/goals')}>
                <div className="goals-block-head">
                  <span className="detail-label">🎯 Goals</span>
                  {bestStreak >= 2 && (
                    <span className="streak-badge">
                      🔥 <AnimatedNumber value={bestStreak} />
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
          if (b.id === 'recap') {
            const nothingYet =
              recap.goalsCompleted === 0 && recap.contactsReconnected === 0 && recap.tasksCompleted === 0;
            if (nothingYet) return null;
            return (
              <section className="detail-section recap-block" key="recap">
                <span className="detail-label">📊 This week</span>
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
                <span className="detail-label">🔔 Important reminders</span>
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
                  {tasks.map((t) => (
                    <li key={t.id}>
                      <SwipeToDelete
                        ref={(el) => {
                          if (el) taskSwipeRefs.current.set(t.id, el);
                          else taskSwipeRefs.current.delete(t.id);
                        }}
                        onDelete={() => deleteTaskWithUndo(t)}
                      >
                        <div className="task-row">
                          <button
                            className={`task-check${t.done || justCompletedIds.has(t.id) ? ' task-check--on' : ''}${(t.done || justCompletedIds.has(t.id)) && taskCompleteAnim ? ' task-check--pop' : ''}`}
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
                              {t.repeat && t.repeat !== 'none' && <span className="repeat-glyph"> ↻</span>}
                            </span>
                            {(t.location || t.dueDate) && !t.done && (
                              <span className="task-meta muted small">
                                {[t.location, t.dueDate && formatShortDate(t.dueDate)].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </button>
                          {t.dueTime && !t.done && <span className="reminder-time">{formatTime(t.dueTime)}</span>}
                          <button
                            className="icon-btn task-del"
                            onClick={() => taskSwipeRefs.current.get(t.id)?.remove()}
                            aria-label="Delete task"
                          >
                            ✕
                          </button>
                        </div>
                      </SwipeToDelete>
                    </li>
                  ))}
                  {tasks.length === 0 && <li className="muted small">No tasks yet.</li>}
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
                  <span className="detail-label">📝 Notes</span>
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
                        {n.pinned && <span className="note-pin">📌</span>}
                        {n.title && <strong className="note-title">{n.title}</strong>}
                        {n.checklist ? (
                          <ul className="note-checklist">
                            {n.checklist.slice(0, 5).map((item, i) => (
                              <li key={i} className={item.done ? 'note-check--done' : ''}>
                                <span className={`note-check-box${item.done ? ' note-check-box--on' : ''}`}>
                                  {item.done ? '✓' : ''}
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
                autoFocus
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
                      ✕
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
              <div className="color-grid">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c || 'none'}
                    type="button"
                    className={`color-dot${!c ? ' color-dot--clear' : ''}${editingNote.color === c ? ' color-dot--on' : ''}`}
                    style={c ? { background: c } : undefined}
                    onClick={() => setEditingNote({ ...editingNote, color: c })}
                  >
                    {!c && '✕'}
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
                autoFocus
                value={editingTask.title}
                onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                placeholder="What needs doing?"
              />
            </label>
            <label className="field">
              <span>Location</span>
              <input
                value={editingTask.location}
                onChange={(e) => setEditingTask({ ...editingTask, location: e.target.value })}
                placeholder="Optional"
              />
            </label>
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
                <div className="chips">
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

function MiniRing({ pct, label }) {
  const shown = useCountUp(pct);
  return (
    <div className="mini-ring-wrap">
      <div className="mini-ring" style={{ background: `conic-gradient(var(--accent) ${shown * 3.6}deg, var(--track) 0deg)` }}>
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
