import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useActions } from '../data/store.jsx';
import EditorSheet from '../components/EditorSheet.jsx';
import Checkbox from '../components/Checkbox.jsx';
import { Brand } from '../components/Logo.jsx';
import { successTick, selectTick } from '../data/haptics.js';
import { useCountUp } from '../data/useCountUp.js';
import AnimatedNumber from '../components/AnimatedNumber.jsx';
import MilestoneCelebration from '../components/MilestoneCelebration.jsx';
import {
  goalKey,
  weekKey,
  startOfWeek,
  addDays,
  toISODate,
  todayISO,
  fromISODate,
  formatWeekRange,
  formatDayLabel,
  isToday,
  computeGoalStreak,
  goalFreezesLeft,
  WEEKDAY_LETTERS,
} from '../data/helpers.js';
import {
  requestNotificationPermission,
  notificationsSupported,
} from '../data/notifications.js';

const emptyGoal = (period) => ({
  title: '',
  category: '',
  period,
  target: 1,
  unit: '',
  repeatDays: [],
  reminderOn: false,
  reminderTime: '09:00',
});

export default function GoalsPage() {
  const { state } = useStore();
  const actions = useActions();
  const navigate = useNavigate();
  const isPro = !!state.settings?.isPro;
  const [period, setPeriod] = useState('daily');
  const [day, setDay] = useState(() => todayISO());
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [editing, setEditing] = useState(null);
  const [celebrate, setCelebrate] = useState(null);
  const streakSeenRef = useRef(null); // goalId -> last-seen streak, seeded silently on first sight

  // Fire a one-time celebration the moment a goal's streak crosses a
  // milestone (7/30/100), rather than every time the page happens to render
  // while already past one — the ref is seeded (not compared) on the very
  // first sighting of each goal so simply opening the page never retriggers
  // a milestone the goal already passed in an earlier session.
  useEffect(() => {
    const seen = streakSeenRef.current || new Map();
    const milestones = [7, 30, 100];
    for (const g of state.goals) {
      const streak = computeGoalStreak(g);
      const prev = seen.has(g.id) ? seen.get(g.id) : streak;
      if (streak > prev) {
        const crossed = milestones.filter((m) => prev < m && streak >= m).pop();
        if (crossed) {
          successTick();
          setCelebrate({
            title: g.title,
            milestone: crossed,
            periodLabel: (g.period || 'weekly') === 'daily' ? 'day' : 'week',
          });
        }
      }
      seen.set(g.id, streak);
    }
    streakSeenRef.current = seen;
  }, [state.goals]);

  const isDaily = period === 'daily';
  const ctx = isDaily ? fromISODate(day) : weekStart;
  const key = goalKey(period, ctx);
  const atCurrent = isDaily ? isToday(day) : weekKey(weekStart) === weekKey(new Date());

  const goals = useMemo(() => {
    const dow = isDaily ? fromISODate(day).getDay() : null;
    return state.goals.filter((g) => {
      if ((g.period || 'weekly') !== period) return false;
      if (isDaily && g.repeatDays?.length) return g.repeatDays.includes(dow);
      return true;
    });
  }, [state.goals, period, isDaily, day]);
  const progressOf = (g) => g.progress?.[key] || 0;

  // Press-and-hold on a stepper +/- button: after holding past HOLD_DELAY_MS
  // it starts auto-repeating at REPEAT_INTERVAL_MS until released, instead of
  // requiring a tap per step. A plain tap still applies exactly one step —
  // repeat mode only engages once the hold has actually lasted a second, and
  // the click that a pointerup would otherwise also fire is suppressed once
  // it has, so holding never double-applies its last step.
  const HOLD_DELAY_MS = 1000;
  const REPEAT_INTERVAL_MS = 150;
  const stateRef = useRef(state);
  stateRef.current = state;
  const holdRef = useRef({});
  const suppressClickRef = useRef(null);

  useEffect(
    () => () => {
      Object.values(holdRef.current).forEach((h) => {
        clearTimeout(h.timer);
        clearInterval(h.intervalId);
      });
    },
    []
  );

  // `repeatTick` is only passed from the hold-repeat path below: a plain tap
  // already gets its "select" tick from the app-wide delegated pointerdown
  // listener, but repeated auto-increments never fire another pointerdown,
  // so they need their own light tick to keep confirming each step landed —
  // unless this is the step that completes the goal, which keeps the
  // stronger successTick instead of also firing this one.
  const applyDelta = (goalId, periodKey, delta, { repeatTick = false } = {}) => {
    const g = stateRef.current.goals.find((x) => x.id === goalId);
    if (!g) return;
    const current = g.progress?.[periodKey] || 0;
    const wasDone = current >= g.target;
    const next = Math.max(0, current + delta);
    actions.setGoalProgress(goalId, periodKey, next);
    if (delta > 0 && !wasDone && next >= g.target) successTick();
    else if (repeatTick) selectTick();
  };
  const useFreeze = (g, periodKey) => {
    if ((g.frozenKeys || []).includes(periodKey)) return;
    if (goalFreezesLeft(g, isPro) <= 0) return;
    actions.updateGoal({ ...g, frozenKeys: [...(g.frozenKeys || []), periodKey] });
    successTick();
  };
  const clearHold = (holdKey) => {
    const h = holdRef.current[holdKey];
    if (!h) return;
    clearTimeout(h.timer);
    clearInterval(h.intervalId);
    delete holdRef.current[holdKey];
  };
  const startHold = (goalId, periodKey, delta) => {
    const holdKey = `${goalId}:${delta}`;
    clearHold(holdKey);
    const h = { repeating: false };
    holdRef.current[holdKey] = h;
    h.timer = setTimeout(() => {
      h.repeating = true;
      applyDelta(goalId, periodKey, delta, { repeatTick: true });
      h.intervalId = setInterval(() => applyDelta(goalId, periodKey, delta, { repeatTick: true }), REPEAT_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  };
  const endHold = (goalId, delta) => {
    const holdKey = `${goalId}:${delta}`;
    if (holdRef.current[holdKey]?.repeating) suppressClickRef.current = holdKey;
    clearHold(holdKey);
  };

  const totals = useMemo(() => {
    const target = goals.reduce((s, g) => s + (g.target || 0), 0);
    const done = goals.reduce((s, g) => s + Math.min(progressOf(g), g.target || 0), 0);
    const met = goals.filter((g) => progressOf(g) >= (g.target || 0) && g.target > 0).length;
    return { target, done, met, pct: target ? Math.round((done / target) * 100) : 0 };
  }, [goals, key]);
  const shownTotalsPct = useCountUp(totals.pct);

  const groups = useMemo(() => {
    const map = new Map();
    for (const g of goals) {
      const cat = g.category?.trim() || 'General';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(g);
    }
    return [...map.entries()];
  }, [goals]);

  const initialJsonRef = useRef('');
  const openEdit = (g) => {
    const d = {
      ...g,
      repeatDays: g.repeatDays || [],
      reminderOn: !!g.reminder,
      reminderTime: g.reminder?.time || '09:00',
    };
    setEditing(d);
    initialJsonRef.current = JSON.stringify(d);
  };
  const openNew = () => {
    const d = emptyGoal(period);
    setEditing(d);
    initialJsonRef.current = JSON.stringify(d);
  };
  const dirty = editing ? JSON.stringify(editing) !== initialJsonRef.current : false;

  const toggleWeekday = (i) => {
    const set = new Set(editing.repeatDays || []);
    if (set.has(i)) set.delete(i);
    else set.add(i);
    setEditing({ ...editing, repeatDays: [...set].sort() });
  };

  const saveGoal = async () => {
    const title = editing.title.trim();
    if (!title) return;
    if (editing.reminderOn) {
      await requestNotificationPermission();
      actions.setSettings({ notifications: true });
    }
    const payload = {
      title,
      category: editing.category.trim(),
      period: editing.period,
      target: Math.max(1, Number(editing.target) || 1),
      unit: editing.unit.trim(),
      repeatDays: editing.period === 'daily' ? editing.repeatDays || [] : [],
      reminder: editing.reminderOn ? { time: editing.reminderTime } : null,
    };
    if (editing.id) actions.updateGoal({ ...editing, ...payload });
    else actions.addGoal(payload);
    setEditing(null);
  };

  const stepDay = (n) => setDay(toISODate(addDays(day, n)));

  return (
    <div className="page">
      <MilestoneCelebration celebrate={celebrate} onDone={() => setCelebrate(null)} />
      <header className="page-head">
        <div className="page-head-row">
          <Brand>Goals</Brand>
        </div>
        <div className="seg seg--full">
          <button className={`seg-btn${isDaily ? ' seg-btn--on' : ''}`} onClick={() => setPeriod('daily')}>
            Today
          </button>
          <button className={`seg-btn${!isDaily ? ' seg-btn--on' : ''}`} onClick={() => setPeriod('weekly')}>
            This week
          </button>
        </div>
        <div className="week-nav">
          <button
            className="icon-btn"
            onClick={() => (isDaily ? stepDay(-1) : setWeekStart(addDays(weekStart, -7)))}
            aria-label="Previous"
          >
            <Chevron dir="left" />
          </button>
          <button
            className="week-label"
            onClick={() => (isDaily ? setDay(todayISO()) : setWeekStart(startOfWeek(new Date())))}
          >
            {isDaily
              ? atCurrent
                ? 'Today'
                : formatDayLabel(day)
              : atCurrent
              ? 'This week'
              : formatWeekRange(weekStart)}
            <span className="week-sub">{isDaily ? formatDayLabel(day) : formatWeekRange(weekStart)}</span>
          </button>
          <button
            className="icon-btn"
            onClick={() => (isDaily ? stepDay(1) : setWeekStart(addDays(weekStart, 7)))}
            aria-label="Next"
          >
            <Chevron dir="right" />
          </button>
        </div>
      </header>

      {goals.length > 0 && (
        <section className="summary-card">
          <div className="summary-ring" style={ringStyle(shownTotalsPct)}>
            <span>{shownTotalsPct}%</span>
          </div>
          <div className="summary-meta">
            <strong>
              {totals.met} of {goals.length} {isDaily ? 'daily' : 'weekly'} goals met
            </strong>
            <span className="muted">
              {totals.done} of {totals.target} {isDaily ? 'today' : 'this week'}
            </span>
          </div>
        </section>
      )}

      {goals.length === 0 ? (
        <EmptyState isDaily={isDaily} onAdd={() => openNew()} />
      ) : (
        groups.map(([category, list]) => (
          <section key={category} className="goal-group">
            <h3 className="group-title">{category}</h3>
            {list.map((g) => {
              const value = progressOf(g);
              const pct = g.target ? Math.min(100, Math.round((value / g.target) * 100)) : 0;
              const done = value >= g.target;
              const streak = computeGoalStreak(g);
              const frozenHere = (g.frozenKeys || []).includes(key);
              const freezesLeft = goalFreezesLeft(g, isPro);
              // Freezing only makes sense for the period actually in progress
              // right now — not some other day/week the user has navigated to.
              const canFreeze = atCurrent && !done && !frozenHere && freezesLeft > 0 && streak >= 1;
              const outOfFreezes = atCurrent && !done && !frozenHere && freezesLeft === 0 && streak >= 1 && !isPro;
              return (
                <div key={g.id}>
                  <div className={`goal-card${done ? ' goal-card--done' : ''}`}>
                    <button className="goal-info" onClick={() => openEdit(g)}>
                      <div className="goal-title-row">
                        <span className="goal-title">{g.title}</span>
                        {/* Only worth flagging once it's actually a streak — a
                            single completion doesn't need a badge. */}
                        {streak >= 2 && (
                          <span className="streak-badge" title={`${streak} ${g.period === 'daily' ? 'days' : 'weeks'} in a row`}>
                            🔥 <AnimatedNumber value={streak} />
                          </span>
                        )}
                        {frozenHere && (
                          <span className="streak-badge streak-badge--frozen" title="This period is protected by a streak freeze">
                            ❄️ Protected
                          </span>
                        )}
                        {g.reminder && <span className="bell-badge" title={`Reminder at ${g.reminder.time}`}>🔔</span>}
                        {done && <span className="check-badge" aria-label="Goal met">✓</span>}
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="goal-count">
                        {value} / {g.target} {g.unit}
                      </span>
                    </button>
                    <div className="stepper">
                      <button
                        className="step-btn"
                        data-haptic="select"
                        onPointerDown={() => startHold(g.id, key, -1)}
                        onPointerUp={() => endHold(g.id, -1)}
                        onPointerLeave={() => clearHold(`${g.id}:-1`)}
                        onPointerCancel={() => clearHold(`${g.id}:-1`)}
                        onClick={() => {
                          const holdKey = `${g.id}:-1`;
                          if (suppressClickRef.current === holdKey) {
                            suppressClickRef.current = null;
                            return;
                          }
                          applyDelta(g.id, key, -1);
                        }}
                        disabled={value <= 0}
                        aria-label={`Decrease ${g.title}`}
                      >
                        −
                      </button>
                      <button
                        className="step-btn step-btn--plus"
                        data-haptic={!done && value + 1 >= g.target ? 'none' : 'select'}
                        onPointerDown={() => startHold(g.id, key, 1)}
                        onPointerUp={() => endHold(g.id, 1)}
                        onPointerLeave={() => clearHold(`${g.id}:1`)}
                        onPointerCancel={() => clearHold(`${g.id}:1`)}
                        onClick={() => {
                          const holdKey = `${g.id}:1`;
                          if (suppressClickRef.current === holdKey) {
                            suppressClickRef.current = null;
                            return;
                          }
                          applyDelta(g.id, key, 1);
                        }}
                        aria-label={`Increase ${g.title}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  {canFreeze && (
                    <button
                      className="freeze-row"
                      data-haptic="select"
                      onClick={() => useFreeze(g, key)}
                    >
                      ❄️ Use a streak freeze to protect {isDaily ? 'today' : 'this week'} ({freezesLeft} left this month)
                    </button>
                  )}
                  {outOfFreezes && (
                    <button className="freeze-row" data-haptic="select" onClick={() => navigate('/pricing')}>
                      🔒 Out of freezes this month — get 5/mo with Pro
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        ))
      )}

      <button className="fab" onClick={() => openNew()} aria-label="New goal">
        +
      </button>

      <EditorSheet
        open={!!editing}
        title={editing?.id ? 'Edit goal' : 'New goal'}
        dirty={dirty}
        onSave={saveGoal}
        onDiscard={() => setEditing(null)}
        danger={
          editing?.id
            ? {
                label: 'Delete goal',
                onClick: () => {
                  actions.deleteGoal(editing.id);
                  setEditing(null);
                },
              }
            : undefined
        }
      >
        {editing && (
          <div className="form">
            <label className="field">
              <span>Goal</span>
              <input
                autoFocus
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                placeholder="e.g. Drink water"
              />
            </label>
            {editing.id && (
              <button
                type="button"
                className="btn btn-ghost btn-sm history-link"
                onClick={() => (isPro ? navigate(`/goals/${editing.id}/history`) : navigate('/pricing'))}
              >
                📈 View history {!isPro && '🔒'}
              </button>
            )}
            <div className="field">
              <span>Repeats</span>
              <div className="seg seg--full">
                <button
                  className={`seg-btn${editing.period === 'daily' ? ' seg-btn--on' : ''}`}
                  onClick={() => setEditing({ ...editing, period: 'daily' })}
                >
                  Daily
                </button>
                <button
                  className={`seg-btn${editing.period === 'weekly' ? ' seg-btn--on' : ''}`}
                  onClick={() => setEditing({ ...editing, period: 'weekly' })}
                >
                  Weekly
                </button>
              </div>
            </div>
            {editing.period === 'daily' && (
              <div className="field">
                <span>Repeat on</span>
                <div className="weekday-picker">
                  {WEEKDAY_LETTERS.map((l, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`weekday-btn${(editing.repeatDays || []).includes(i) ? ' weekday-btn--on' : ''}`}
                      onClick={() => toggleWeekday(i)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <p className="muted small">Leave all days off to repeat every day.</p>
              </div>
            )}
            <label className="field">
              <span>Category</span>
              <input
                value={editing.category}
                onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                placeholder="e.g. Health"
                list="goal-categories"
              />
              <datalist id="goal-categories">
                {[...new Set(state.goals.map((g) => g.category).filter(Boolean))].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <div className="field-row">
              <label className="field">
                <span>{editing.period === 'daily' ? 'Daily' : 'Weekly'} target</span>
                <input
                  type="number"
                  min="1"
                  value={editing.target}
                  onChange={(e) => setEditing({ ...editing, target: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Unit</span>
                <input
                  value={editing.unit}
                  onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                  placeholder="e.g. glasses"
                />
              </label>
            </div>

            <div className="field">
              <label className="check-row">
                <Checkbox
                  checked={editing.reminderOn}
                  onChange={(e) => setEditing({ ...editing, reminderOn: e.target.checked })}
                  ariaLabel="Remind me"
                />
                <span>Remind me</span>
              </label>
              {editing.reminderOn && (
                <>
                  <input
                    type="time"
                    value={editing.reminderTime}
                    onChange={(e) => setEditing({ ...editing, reminderTime: e.target.value })}
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

function EmptyState({ isDaily, onAdd }) {
  return (
    <div className="empty">
      <div className="empty-icon">🎯</div>
      <h2>{isDaily ? 'Set a daily goal' : 'Set a weekly goal'}</h2>
      <p className="muted">
        {isDaily
          ? 'Small daily habits — water, reading, steps — with progress that resets each day.'
          : 'Weekly targets like workouts or people to reach out to, tracked across the week.'}
      </p>
      <button className="btn btn-primary" onClick={onAdd}>
        + New goal
      </button>
    </div>
  );
}

function ringStyle(pct) {
  return { background: `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--track) 0deg)` };
}

function Chevron({ dir }) {
  const d = dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6';
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
