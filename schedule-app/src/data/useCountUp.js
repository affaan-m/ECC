import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 600;

// Animates a number smoothly toward `value` whenever it changes, instead of
// snapping instantly — used for goal-ring percentages and streak counts so
// progress feels alive rather than jumpy. Skips the animation on first
// mount (nothing to count up from) and picks up mid-flight from wherever
// the display currently is if `value` changes again before a prior
// animation finishes.
export function useCountUp(value, duration = DURATION_MS) {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  const rafRef = useRef(null);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const from = displayRef.current;
    if (from === value) return undefined;
    const isInt = Number.isInteger(value) && Number.isInteger(from);
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (value - from) * eased;
      const next = isInt ? Math.round(current) : current;
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return display;
}
