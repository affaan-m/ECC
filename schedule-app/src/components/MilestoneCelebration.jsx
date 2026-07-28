import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

const PIECE_COUNT = 16;
const PIECES = Array.from({ length: PIECE_COUNT }, (_, i) => i);
const AUTO_DISMISS_MS = 1700;

// A brief, non-blocking confetti burst + card shown when a goal's streak
// first crosses a milestone (7/30/100). `celebrate` is null when idle, or
// { title, milestone, periodLabel }. Auto-dismisses itself via onDone.
export default function MilestoneCelebration({ celebrate, onDone }) {
  // onDone is an inline callback that gets a new identity on every render of
  // the parent (e.g. while a count-up animation elsewhere on the page is
  // re-rendering it) — keying the timer to that identity instead of a ref
  // would keep resetting the countdown and the card would never dismiss.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!celebrate) return undefined;
    const t = setTimeout(() => onDoneRef.current?.(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [celebrate]);

  if (!celebrate) return null;

  return (
    <div className="milestone-overlay" role="status">
      <div className="milestone-confetti">
        {PIECES.map((i) => {
          const angle = (i / PIECE_COUNT) * Math.PI * 2;
          const dist = 70 + (i % 3) * 22;
          const dx = Math.cos(angle) * dist;
          const dy = Math.sin(angle) * dist;
          const hue = (i * 47) % 360;
          return (
            <span
              key={i}
              className="confetti-piece"
              style={{
                '--dx': `${dx}px`,
                '--dy': `${dy}px`,
                background: `hsl(${hue} 80% 55%)`,
                animationDelay: `${(i % 4) * 20}ms`,
              }}
            />
          );
        })}
      </div>
      <div className="milestone-card">
        <span className="milestone-fire" aria-hidden="true">
          <Icon name="flame" size={30} />
        </span>
        <strong>
          {celebrate.milestone}-{celebrate.periodLabel} streak!
        </strong>
        <span className="muted">{celebrate.title}</span>
      </div>
    </div>
  );
}
