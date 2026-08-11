import { useEffect, useRef } from 'react';

// Pages that seed a "which day am I looking at" state once at mount (e.g.
// `useState(() => todayISO())`) and never advance it afterward drift stale
// across a real midnight: a PWA gets backgrounded and resumed constantly
// rather than reloaded, so the tab never notices the date changed underneath
// it. Planner's `cursor` and Goals' `day`/`weekStart` both hit this
// independently — same defect, same fix, previously copy-pasted into each
// page. This hook is that fix, extracted once so a third page doesn't have
// to rediscover and re-verify it from scratch.
//
// Call the returned `manualNavRef.current = true` right before any state
// update that deliberately moves away from today (paging, jumping to a
// specific date, following a link to some other day) — everything else is
// left untouched. Set it back to `false` from whatever action returns to
// "today" (a today-button, jump-to-now), so auto-resync resumes.
//
// `onResync` is called to actually move the state back to today; it's only
// invoked when the tab is visible and manual nav isn't in effect, so it's
// safe to call unconditionally without re-checking either.
//
// visibilitychange/focus cover the common cases (switching apps, unlocking
// the phone) but aren't guaranteed on every platform — a screen simply
// timing out and back on doesn't reliably fire either — so a low-cost
// interval check backs them up rather than depending on any one event.
export function useTodayResync(onResync, intervalMs = 60000) {
  const manualNavRef = useRef(false);
  const onResyncRef = useRef(onResync);
  onResyncRef.current = onResync;

  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === 'hidden') return;
      if (manualNavRef.current) return;
      onResyncRef.current();
    };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);
    const timer = setInterval(resync, intervalMs);
    return () => {
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);

  return manualNavRef;
}
