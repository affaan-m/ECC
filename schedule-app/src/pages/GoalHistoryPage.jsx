import { useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../data/store.jsx';
import { computeGoalStreak } from '../data/helpers.js';
import { buildGoalHistory, longestGoalStreak } from '../data/goalHistory.js';

const DAILY_WINDOW = 84; // ~12 weeks
const WEEKLY_WINDOW = 12;

export default function GoalHistoryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useStore();
  const isPro = !!state.settings?.isPro;
  const goal = state.goals.find((g) => g.id === id);

  // Direct-URL / back-forward navigation could otherwise land a free user
  // here even though the entry point (Goals → edit → View history) already
  // gates the link — this is the same defense-in-depth other Pro-only
  // pages in the app use.
  useEffect(() => {
    if (!isPro) navigate('/pricing', { replace: true });
  }, [isPro, navigate]);

  const isDaily = (goal?.period || 'weekly') === 'daily';
  const windowSize = isDaily ? DAILY_WINDOW : WEEKLY_WINDOW;
  const history = useMemo(() => (goal ? buildGoalHistory(goal, windowSize) : []), [goal, windowSize]);
  const longest = useMemo(() => (goal ? longestGoalStreak(goal) : 0), [goal]);

  if (!isPro) return null;

  if (!goal) {
    return (
      <div className="page">
        <header className="page-head">
          <button className="back-btn" onClick={() => navigate('/goals')}>
            ‹ Goals
          </button>
        </header>
        <p className="muted center-pad">This goal no longer exists.</p>
      </div>
    );
  }

  const streak = computeGoalStreak(goal);
  const metCount = history.filter((h) => h.met).length;
  const rate = history.length ? Math.round((metCount / history.length) * 100) : 0;

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-row">
          <button className="back-btn" onClick={() => navigate('/goals')}>
            ‹ Goals
          </button>
        </div>
        <h1>{goal.title}</h1>
      </header>

      <section className="detail-section history-stats">
        <div className="history-stat">
          <strong>{streak}</strong>
          <span className="muted small">Current streak</span>
        </div>
        <div className="history-stat">
          <strong>{longest}</strong>
          <span className="muted small">Longest streak</span>
        </div>
        <div className="history-stat">
          <strong>{rate}%</strong>
          <span className="muted small">Last {WEEKLY_WINDOW} weeks</span>
        </div>
      </section>

      <section className="detail-section">
        <span className="detail-label">{isDaily ? `Last ${DAILY_WINDOW} days` : `Last ${WEEKLY_WINDOW} weeks`}</span>
        {isDaily ? (
          <div className="history-heatmap">
            {history.map((h) => (
              <span
                key={h.key}
                className={`heatmap-cell${h.met ? (h.frozen ? ' heatmap-cell--frozen' : ' heatmap-cell--met') : ''}`}
                title={`${h.key}: ${h.value}/${h.target}${h.frozen ? ' (protected by a freeze)' : ''}`}
              />
            ))}
          </div>
        ) : (
          <div className="history-bars">
            {history.map((h) => (
              <div key={h.key} className="history-bar-col" title={`${h.key}: ${h.value}/${h.target}`}>
                <div
                  className={`history-bar${h.met ? (h.frozen ? ' history-bar--frozen' : ' history-bar--met') : ''}`}
                  style={{ height: `${Math.max(4, h.pct)}%` }}
                />
              </div>
            ))}
          </div>
        )}
        <div className="history-legend">
          <span><i className="legend-dot legend-dot--met" /> Met</span>
          <span><i className="legend-dot legend-dot--frozen" /> Frozen</span>
          <span><i className="legend-dot" /> Missed</span>
        </div>
      </section>
    </div>
  );
}
