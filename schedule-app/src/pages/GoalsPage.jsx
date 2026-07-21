import { useMemo, useState } from 'react';
import { useStore, useActions } from '../data/store.jsx';
import Modal from '../components/Modal.jsx';
import { weekKey, startOfWeek, addDays, formatWeekRange } from '../data/helpers.js';

const EMPTY_GOAL = { title: '', category: '', target: 1, unit: '' };

export default function GoalsPage() {
  const { state } = useStore();
  const actions = useActions();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [editing, setEditing] = useState(null); // goal object or EMPTY_GOAL

  const week = weekKey(weekStart);
  const isThisWeek = week === weekKey(new Date());

  const progressOf = (g) => g.weeklyProgress?.[week] || 0;

  const totals = useMemo(() => {
    const target = state.goals.reduce((s, g) => s + (g.target || 0), 0);
    const done = state.goals.reduce((s, g) => s + Math.min(progressOf(g), g.target || 0), 0);
    const met = state.goals.filter((g) => progressOf(g) >= (g.target || 0) && g.target > 0).length;
    return { target, done, met, pct: target ? Math.round((done / target) * 100) : 0 };
  }, [state.goals, week]);

  // Group goals by category, preserving first-seen order.
  const groups = useMemo(() => {
    const map = new Map();
    for (const g of state.goals) {
      const key = g.category?.trim() || 'General';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(g);
    }
    return [...map.entries()];
  }, [state.goals]);

  const saveGoal = () => {
    const title = editing.title.trim();
    if (!title) return;
    const payload = {
      title,
      category: editing.category.trim(),
      target: Math.max(1, Number(editing.target) || 1),
      unit: editing.unit.trim(),
    };
    if (editing.id) actions.updateGoal({ ...editing, ...payload });
    else actions.addGoal(payload);
    setEditing(null);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-row">
          <h1>Goals</h1>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...EMPTY_GOAL })}>
            + New
          </button>
        </div>
        <div className="week-nav">
          <button className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
            <Chevron dir="left" />
          </button>
          <button
            className="week-label"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            title="Jump to this week"
          >
            {isThisWeek ? 'This week' : formatWeekRange(weekStart)}
            <span className="week-sub">{formatWeekRange(weekStart)}</span>
          </button>
          <button className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
            <Chevron dir="right" />
          </button>
        </div>
      </header>

      {state.goals.length > 0 && (
        <section className="summary-card">
          <div className="summary-ring" style={ringStyle(totals.pct)}>
            <span>{totals.pct}%</span>
          </div>
          <div className="summary-meta">
            <strong>{totals.met} of {state.goals.length} goals met</strong>
            <span className="muted">
              {totals.done} of {totals.target} total this week
            </span>
          </div>
        </section>
      )}

      {state.goals.length === 0 ? (
        <EmptyState onAdd={() => setEditing({ ...EMPTY_GOAL })} />
      ) : (
        groups.map(([category, goals]) => (
          <section key={category} className="goal-group">
            <h3 className="group-title">{category}</h3>
            {goals.map((g) => {
              const value = progressOf(g);
              const pct = g.target ? Math.min(100, Math.round((value / g.target) * 100)) : 0;
              const done = value >= g.target;
              return (
                <div key={g.id} className={`goal-card${done ? ' goal-card--done' : ''}`}>
                  <button className="goal-info" onClick={() => setEditing(g)}>
                    <div className="goal-title-row">
                      <span className="goal-title">{g.title}</span>
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
                      onClick={() => actions.setGoalProgress(g.id, week, value - 1)}
                      disabled={value <= 0}
                      aria-label={`Decrease ${g.title}`}
                    >
                      −
                    </button>
                    <button
                      className="step-btn step-btn--plus"
                      onClick={() => actions.setGoalProgress(g.id, week, value + 1)}
                      aria-label={`Increase ${g.title}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        ))
      )}

      <Modal
        open={!!editing}
        title={editing?.id ? 'Edit goal' : 'New goal'}
        onClose={() => setEditing(null)}
        footer={
          <div className="modal-actions">
            {editing?.id && (
              <button
                className="btn btn-danger-ghost"
                onClick={() => {
                  actions.deleteGoal(editing.id);
                  setEditing(null);
                }}
              >
                Delete
              </button>
            )}
            <button className="btn btn-primary" onClick={saveGoal}>
              Save
            </button>
          </div>
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
                placeholder="e.g. Workouts"
              />
            </label>
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
                <span>Weekly target</span>
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
                  placeholder="e.g. sessions"
                />
              </label>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div className="empty">
      <div className="empty-icon">🎯</div>
      <h2>Set your first goal</h2>
      <p className="muted">
        Track weekly targets — workouts, people to reach out to, hours reading —
        and watch your progress fill up each week.
      </p>
      <button className="btn btn-primary" onClick={onAdd}>
        + New goal
      </button>
    </div>
  );
}

function ringStyle(pct) {
  return {
    background: `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--track) 0deg)`,
  };
}

function Chevron({ dir }) {
  const d = dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6';
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
