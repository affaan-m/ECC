import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useActions } from '../data/store.jsx';
import EditorSheet from '../components/EditorSheet.jsx';
import { Brand } from '../components/Logo.jsx';
import { confirmTick } from '../data/haptics.js';
import { todayISO, weekKey, goalKey, formatTime, formatShortDate, expandEventOnDay } from '../data/helpers.js';
import { requestNotificationPermission, notificationsSupported } from '../data/notifications.js';
import { normalizeHomeBubbles } from '../data/homeBubbles.js';
import { normalizeHomeSections } from '../data/homeSections.js';

const NOTE_COLORS = ['', '#fdf2c9', '#e1f3ee', '#e6e6fa', '#ffe1e6', '#dceeff'];

export default function HomePage() {
  const { state } = useStore();
  const actions = useActions();
  const navigate = useNavigate();
  const isPro = !!state.settings?.isPro;
  const taskCompleteAnim = state.settings?.taskCompleteAnim ?? true;
  const tasksSectionRef = useRef(null);
  const notesSectionRef = useRef(null);
  const scrollToSection = (ref) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

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
      if (t.done) continue;
      if (t.reminder?.time) out.push({ kind: 'task', id: t.id, label: t.title, time: t.reminder.time });
      else if (t.dueDate === today) out.push({ kind: 'task', id: t.id, label: t.title, time: null });
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
      reminderOn: false,
      reminderTime: '09:00',
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
      reminderOn: !!t.reminder,
      reminderTime: t.reminder?.time || '09:00',
    };
    setEditingTask(d);
    initialTaskJson.current = JSON.stringify(d);
  };
  const taskDirty = editingTask ? JSON.stringify(editingTask) !== initialTaskJson.current : false;
  const saveTask = async () => {
    const title = editingTask.title.trim();
    if (!title) return setEditingTask(null);
    if (editingTask.reminderOn) {
      await requestNotificationPermission();
      actions.setSettings({ notifications: true });
    }
    const payload = {
      title,
      notes: editingTask.notes.trim(),
      location: editingTask.location.trim(),
      dueDate: editingTask.dueDate,
      reminder: editingTask.reminderOn ? { time: editingTask.reminderTime } : null,
    };
    if (editingTask.id) actions.updateTask({ ...editingTask, ...payload });
    else actions.addTask({ ...payload, createdAt: today });
    setEditingTask(null);
    confirmTick();
  };

  // --- Notes ---
  const [editingNote, setEditingNote] = useState(null);
  const initialNoteJson = useRef('');
  const notes = useMemo(
    () => [...(state.notes || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned)),
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

  // --- Quick add ---
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // --- Home bubbles (Pro: customizable set + order) ---
  const homeBubbles = useMemo(
    () => normalizeHomeBubbles(state.settings?.homeBubbles).filter((b) => b.enabled),
    [state.settings?.homeBubbles]
  );
  const homeSections = useMemo(
    () => normalizeHomeSections(state.settings?.homeSections).filter((s) => s.enabled),
    [state.settings?.homeSections]
  );
  const openTaskCount = tasks.filter((t) => !t.done).length;
  const todaysEvents = useMemo(
    () => [...state.events].filter((e) => e.date === today).sort((a, b) => (a.start || '').localeCompare(b.start || '')),
    [state.events, today]
  );
  const nextEvent = todaysEvents.find((e) => !e.done) || null;

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-row">
          <Brand>Home</Brand>
          {!isPro && (
            <button className="pro-bubble" onClick={() => navigate('/pricing')}>
              <CrownIcon /> Pro
            </button>
          )}
        </div>
      </header>

      <div className="home-bubbles">
        {homeBubbles.map((b) => {
          if (b.id === 'goals') {
            return (
              <button key="goals" className="home-bubble" onClick={() => navigate('/goals')}>
                <div className="home-bubble-rings">
                  <MiniRing pct={dailyPct} label="Today" />
                  <MiniRing pct={weeklyPct} label="Week" />
                </div>
                <span className="home-bubble-label">Goals</span>
              </button>
            );
          }
          if (b.id === 'tasks') {
            return (
              <button key="tasks" className="home-bubble home-bubble--stat" onClick={() => scrollToSection(tasksSectionRef)}>
                <span className="home-bubble-icon">✅</span>
                <span className="home-bubble-stat">{openTaskCount}</span>
                <span className="home-bubble-label">Tasks</span>
              </button>
            );
          }
          if (b.id === 'notes') {
            return (
              <button key="notes" className="home-bubble home-bubble--stat" onClick={() => scrollToSection(notesSectionRef)}>
                <span className="home-bubble-icon">📝</span>
                <span className="home-bubble-stat">{notes.length}</span>
                <span className="home-bubble-label">Notes</span>
              </button>
            );
          }
          if (b.id === 'events') {
            return (
              <button key="events" className="home-bubble home-bubble--stat" onClick={() => navigate('/planner')}>
                <span className="home-bubble-icon">📅</span>
                {nextEvent ? (
                  <span className="home-bubble-textblock">
                    <strong>{nextEvent.title || 'Event'}</strong>
                    <span className="muted small">{formatTime(nextEvent.start)}</span>
                  </span>
                ) : (
                  <span className="home-bubble-textblock muted small">No events today</span>
                )}
              </button>
            );
          }
          if (b.id === 'contacts') {
            return (
              <button key="contacts" className="home-bubble home-bubble--stat" onClick={() => navigate('/contacts')}>
                <span className="home-bubble-icon">👤</span>
                <span className="home-bubble-stat">{state.contacts.length}</span>
                <span className="home-bubble-label">People</span>
              </button>
            );
          }
          return null;
        })}
      </div>

      {homeSections.map((sec) => {
        if (sec.id === 'reminders') {
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
        if (sec.id === 'tasks') {
          return (
            <section className="detail-section" ref={tasksSectionRef} key="tasks">
              <span className="detail-label">Tasks</span>
              <ul className="task-list">
                {tasks.map((t) => (
                  <li key={t.id} className="task-row">
                    <button
                      className={`task-check${t.done ? ' task-check--on' : ''}${t.done && taskCompleteAnim ? ' task-check--pop' : ''}`}
                      onClick={() => {
                        actions.updateTask({ ...t, done: !t.done });
                        if (!t.done) confirmTick();
                      }}
                      aria-label={t.done ? 'Mark not done' : 'Mark done'}
                    >
                      {t.done && <CheckIcon />}
                    </button>
                    <button className="task-title-btn" onClick={() => openEditTask(t)}>
                      <span className={`task-title${t.done ? ' task-title--done' : ''}`}>{t.title}</span>
                      {(t.location || t.dueDate) && !t.done && (
                        <span className="task-meta muted small">
                          {[t.location, t.dueDate && formatShortDate(t.dueDate)].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </button>
                    {t.reminder?.time && !t.done && <span className="reminder-time">{formatTime(t.reminder.time)}</span>}
                    <button className="icon-btn task-del" onClick={() => actions.deleteTask(t.id)} aria-label="Delete task">
                      ✕
                    </button>
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
        if (sec.id === 'notes') {
          return (
            <section className="detail-section" ref={notesSectionRef} key="notes">
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
      })}

      <button className="fab" onClick={() => setQuickAddOpen(true)} aria-label="Quick add">
        +
      </button>

      {quickAddOpen && (
        <div className="select-backdrop" onClick={() => setQuickAddOpen(false)}>
          <div className="select-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="select-grip">
              <span className="modal-handle" />
            </div>
            <div className="select-options">
              <button className="select-option" onClick={() => { setQuickAddOpen(false); navigate('/planner', { state: { quickNewEvent: true } }); }}>
                📅 New event
              </button>
              <button className="select-option" onClick={() => { setQuickAddOpen(false); navigate('/contacts', { state: { quickNewContact: true } }); }}>
                👤 New person
              </button>
              <button className="select-option" onClick={() => { setQuickAddOpen(false); document.querySelector('.task-add-row input')?.focus(); }}>
                ✅ New task
              </button>
              <button className="select-option" onClick={() => { setQuickAddOpen(false); openNewNote(); }}>
                📝 New note
              </button>
            </div>
          </div>
        </div>
      )}

      <EditorSheet
        open={!!editingNote}
        title={editingNote?.id ? 'Edit note' : 'New note'}
        dirty={noteDirty}
        onSave={saveNote}
        onDiscard={() => setEditingNote(null)}
        danger={
          editingNote?.id
            ? { label: 'Delete note', onClick: () => { actions.deleteNote(editingNote.id); setEditingNote(null); } }
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
              <input
                type="checkbox"
                checked={!!editingNote.checklist}
                onChange={(e) => toggleChecklist(e.target.checked)}
              />
              <span>Checklist</span>
            </label>

            {editingNote.checklist ? (
              <div className="field">
                {editingNote.checklist.map((item, i) => (
                  <div className="checklist-row" key={i}>
                    <button
                      type="button"
                      className={`task-check${item.done ? ' task-check--on' : ''}`}
                      onClick={() => {
                        const next = editingNote.checklist.slice();
                        next[i] = { ...next[i], done: !next[i].done };
                        setEditingNote({ ...editingNote, checklist: next });
                      }}
                    >
                      {item.done && <CheckIcon />}
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
              <input
                type="checkbox"
                checked={!!editingNote.pinned}
                onChange={(e) => setEditingNote({ ...editingNote, pinned: e.target.checked })}
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
            ? { label: 'Delete task', onClick: () => { actions.deleteTask(editingTask.id); setEditingTask(null); } }
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
            <label className="field">
              <span>Due date</span>
              <input
                type="date"
                value={editingTask.dueDate}
                onChange={(e) => setEditingTask({ ...editingTask, dueDate: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Notes</span>
              <textarea
                rows="4"
                value={editingTask.notes}
                onChange={(e) => setEditingTask({ ...editingTask, notes: e.target.value })}
                placeholder="Any details…"
              />
            </label>
            <div className="field">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={editingTask.reminderOn}
                  onChange={(e) => setEditingTask({ ...editingTask, reminderOn: e.target.checked })}
                />
                <span>Remind me</span>
              </label>
              {editingTask.reminderOn && (
                <>
                  <input
                    type="time"
                    value={editingTask.reminderTime}
                    onChange={(e) => setEditingTask({ ...editingTask, reminderTime: e.target.value })}
                  />
                  {!notificationsSupported() && (
                    <span className="muted small">This browser can't show notifications.</span>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </EditorSheet>
    </div>
  );
}

function MiniRing({ pct, label }) {
  return (
    <div className="mini-ring-wrap">
      <div className="mini-ring" style={{ background: `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--track) 0deg)` }}>
        <span>{pct}%</span>
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
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M4 12l5 5 11-11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
