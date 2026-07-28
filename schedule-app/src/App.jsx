import { useCallback, useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import TabBar from './components/TabBar.jsx';
import Tutorial from './components/Tutorial.jsx';
import AssistantBubble from './components/AssistantBubble.jsx';
import { runReminderScan, notify, notificationPermission } from './data/notifications.js';
import { tapTick, confirmTick, warnTick, selectTick, successTick } from './data/haptics.js';
import { setUse24hFormat, setSundayWeekStart, distanceMeters } from './data/helpers.js';
import { setHapticsEnabled } from './data/haptics.js';
import { fetchMe, backendConfigured, fetchSyncedData, pushSyncedData } from './data/api.js';
import { CLERK_ENABLED } from './data/clerkConfig.js';
import { setSyncStatus } from './data/syncStatus.js';
import { useToast } from './data/toast.jsx';
import HomePage from './pages/HomePage.jsx';
import GoalsPage from './pages/GoalsPage.jsx';
import GoalHistoryPage from './pages/GoalHistoryPage.jsx';
import PlannerPage from './pages/PlannerPage.jsx';
import ContactsPage from './pages/ContactsPage.jsx';
import ContactDetailPage from './pages/ContactDetailPage.jsx';
import ContactTimelinePage from './pages/ContactTimelinePage.jsx';
import MapPage from './pages/MapPage.jsx';
import RoutePlannerPage from './pages/RoutePlannerPage.jsx';
import MorePage from './pages/MorePage.jsx';
import SharedCalendarsPage from './pages/SharedCalendarsPage.jsx';
import SharedCalendarDetailPage from './pages/SharedCalendarDetailPage.jsx';
import SharedCalendarJoinPage from './pages/SharedCalendarJoinPage.jsx';
import PricingPage from './pages/PricingPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import { useStore, useActions } from './data/store.jsx';

// Keeps state.settings.isPro (read all over the app already) in sync with
// the real subscription status from the backend, once someone's signed in.
// Only ever mounted when CLERK_ENABLED, so useAuth() always has a provider.
function SubscriptionSync() {
  const { isSignedIn, getToken } = useAuth();
  const actions = useActions();
  useEffect(() => {
    if (!isSignedIn || !backendConfigured()) return;
    let cancelled = false;
    fetchMe(getToken)
      .then((me) => {
        if (!cancelled)
          actions.setSettings({
            isPro: me.isPro,
            isLifetime: !!me.isLifetime,
            // Only pre-switch subscribers have one; drives whether the
            // "manage billing" escape hatch is offered.
            subscriptionStatus: me.subscriptionStatus,
          });
      })
      .catch((err) => console.warn('Failed to sync subscription status:', err.message));
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// Keeps the whole app data blob (goals, events, contacts, notes, ...) in step
// with the backend on every device you're signed in on.
//
// It used to pull once, when sync was switched on, and then only ever push.
// That meant a change made on your phone never reached your laptop until the
// laptop was reloaded or the toggle was flipped off and on — which is not
// really sync, it's a backup with extra steps. It now also pulls on a timer,
// whenever the tab becomes visible again, and whenever the network comes
// back, which between them cover every way you'd actually notice staleness:
// picking the other device up, or coming back to this one.
//
// The server's `updatedAt` is the guard against pointless churn: a pull that
// returns something we already have is dropped rather than re-imported, so a
// poll every minute doesn't cause a re-render every minute.
//
// Still deliberately last-write-wins for one person's own devices — not a
// conflict-resolving multi-editor sync. Only ever mounted when CLERK_ENABLED,
// so useAuth() always has a provider.
const PULL_INTERVAL_MS = 60000;
const PUSH_DEBOUNCE_MS = 2500;

function DataSync() {
  const { state } = useStore();
  const actions = useActions();
  const { isSignedIn, getToken } = useAuth();
  const cloudSyncOn = state.settings?.cloudSync !== false;
  const isPro = !!state.settings?.isPro;
  const active = isSignedIn && cloudSyncOn && isPro && backendConfigured();

  const skipNextPushRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  // The server timestamp of the version we already hold, so a pull can tell
  // "nothing new" from "someone else changed something".
  const seenAtRef = useRef(null);
  const busyRef = useRef(false);

  const pull = useCallback(
    async ({ initial = false } = {}) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setSyncStatus({ phase: 'syncing', error: null });
      try {
        const { data, updatedAt } = await fetchSyncedData(getToken);
        if (!data) {
          // Nothing up there yet — seed it from this device.
          const res = await pushSyncedData(getToken, stateRef.current);
          seenAtRef.current = res?.updatedAt ?? null;
        } else if (initial || !seenAtRef.current || updatedAt > seenAtRef.current) {
          seenAtRef.current = updatedAt ?? null;
          skipNextPushRef.current = true;
          actions.importData(data);
        }
        setSyncStatus({ phase: 'idle', at: Date.now(), error: null });
      } catch (err) {
        setSyncStatus({ phase: 'error', error: err.message });
        console.warn('Cloud sync: pull failed:', err.message);
      } finally {
        busyRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getToken]
  );

  // Initial pull, plus every way of noticing the other device changed
  // something: a timer, coming back to the tab, and regaining the network.
  useEffect(() => {
    if (!active) {
      seenAtRef.current = null;
      setSyncStatus({ phase: 'off', error: null });
      return undefined;
    }
    pull({ initial: true });
    const timer = setInterval(pull, PULL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') pull();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', pull);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', pull);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Debounced push whenever local data changes while sync is active.
  useEffect(() => {
    if (!active) return undefined;
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false;
      return undefined;
    }
    const timer = setTimeout(() => {
      setSyncStatus({ phase: 'syncing', error: null });
      pushSyncedData(getToken, state)
        .then((res) => {
          // Remember our own write, so the next poll doesn't mistake it for
          // a change from somewhere else and re-import what we just sent.
          seenAtRef.current = res?.updatedAt ?? seenAtRef.current;
          setSyncStatus({ phase: 'idle', at: Date.now(), error: null });
        })
        .catch((err) => {
          setSyncStatus({ phase: 'error', error: err.message });
          console.warn('Cloud sync: push failed:', err.message);
        });
    }, PUSH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, active]);

  return null;
}

// Best-effort "you've arrived" reminders for pins the user opted in to (Map →
// edit a pin → Arrival reminder). A PWA has no true background geofencing —
// especially on iOS, which has neither a Geofencing API nor reliable
// background geolocation for web apps — so this only ever watches position
// while Keystone is open in a tab (foreground or briefly backgrounded), the
// same honest limitation as the existing time-based reminder scanner above.
function ArrivalWatch() {
  const { state } = useStore();
  const showToast = useToast();
  const stateRef = useRef(state);
  stateRef.current = state;
  const insideRef = useRef(new Set()); // pin ids currently inside their radius
  const watchIdRef = useRef(null);

  const enabled = !!state.settings?.locationRemindersEnabled;
  const armedPins = (state.pins || []).filter((p) => p.arriveRadius > 0);
  const hasArmedPins = armedPins.length > 0;

  useEffect(() => {
    if (!enabled || !hasArmedPins || !navigator.geolocation) return undefined;

    const onPosition = (pos) => {
      const { latitude, longitude } = pos.coords;
      for (const p of (stateRef.current.pins || []).filter((x) => x.arriveRadius > 0)) {
        const dist = distanceMeters(latitude, longitude, p.lat, p.lng);
        const isInside = dist <= p.arriveRadius;
        const wasInside = insideRef.current.has(p.id);
        if (isInside && !wasInside) {
          insideRef.current.add(p.id);
          warnTick();
          const label = p.label || 'a saved place';
          showToast(`You've arrived near ${label}`);
          if (notificationPermission() === 'granted') {
            notify('You have arrived', `Near ${label}`);
          }
        } else if (!isInside && wasInside) {
          insideRef.current.delete(p.id);
        }
      }
    };

    const watchId = navigator.geolocation.watchPosition(onPosition, () => {}, {
      enableHighAccuracy: false,
      maximumAge: 20000,
      timeout: 20000,
    });
    watchIdRef.current = watchId;
    return () => {
      navigator.geolocation.clearWatch(watchId);
      watchIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hasArmedPins]);

  return null;
}

export default function App() {
  const { state } = useStore();
  const actions = useActions();
  const theme = state.settings?.theme || 'system';
  const location = useLocation();
  const navigate = useNavigate();

  // Best-effort reminder scanner: check due goal/event reminders every 30s
  // while the app is open, plus whenever it returns to the foreground.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const scan = () => runReminderScan(stateRef.current);
    scan();
    const id = setInterval(scan, 30000);
    const onVisible = () => document.visibilityState === 'visible' && scan();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // App-wide haptic feedback: one delegated listener instead of wiring every
  // button individually. Destructive/primary/toggle actions get their own
  // distinct, firmer tick; everything else clickable still gets the
  // lightest tap so navigation, chips, and list rows don't feel dead — that
  // was the "overwhelming" complaint's actual cause (every button ticking
  // at the SAME strength as a save/delete), not tapping in general. Links
  // (Directions, call/text/email quick actions, contact links) are real
  // tap targets too.
  //
  // Elements that need a tick the classList heuristic below can't express —
  // conditional (only warn if there are unsaved changes), state-dependent
  // (a checkbox feels different checking vs. unchecking), or driven by their
  // own gesture rather than a click (drag handles, event blocks) — declare
  // it explicitly with data-haptic instead of also being caught here twice:
  //   data-haptic="none"                 this element manages its own ticks
  //   data-haptic="tap|confirm|warn|select|success"   fire this one instead
  //     of the classList guess (can be set dynamically per render, e.g.
  //     data-haptic={done ? 'tap' : 'success'} for a toggle)
  const HAPTIC_KINDS = { tap: tapTick, confirm: confirmTick, warn: warnTick, select: selectTick, success: successTick };
  // A tick has to wait for an actual press-and-release, not just a touch —
  // firing on pointerdown meant starting a scroll on top of any button (an
  // event block, a list row, a nav link under your thumb) ticked immediately
  // even though the gesture turned into a scroll, not a tap. pointerdown now
  // only arms a pending press; pointermove past a small tolerance (the
  // finger is dragging/scrolling, not tapping) disarms it, and only a
  // pointerup that's still armed actually fires. pointerup is just as
  // "fresh" a trusted gesture as pointerdown for Chrome's vibrate() gesture
  // requirement, so this doesn't reintroduce the setTimeout-drops-vibrate
  // issue fixed earlier — only the trigger event changed, not its freshness.
  const MOVE_CANCEL_PX = 10;
  useEffect(() => {
    let pending = null; // { el, pointerId, startX, startY }

    const fireForElement = (el) => {
      const explicit = el.dataset.haptic;
      if (explicit === 'none') return;
      if (explicit && HAPTIC_KINDS[explicit]) {
        HAPTIC_KINDS[explicit]();
        return;
      }
      // The day timeline's event blocks run their own long-press-to-arm gesture
      // with its own haptics (see PlannerPage) — a delegated tap here on every
      // press would double up with (and pre-empt) that feedback.
      if (el.classList.contains('event-block')) return;
      if (el.getAttribute('role') === 'switch') {
        // Direction-aware: turning a setting ON is a firmer confirm, turning
        // it OFF is the lighter routine tap — instead of every switch in
        // Settings feeling identical regardless of which way it flipped.
        if (el.getAttribute('aria-checked') === 'true') tapTick();
        else confirmTick();
        return;
      }
      if (el.classList.contains('btn-danger') || el.classList.contains('btn-danger-ghost')) warnTick();
      else if (el.classList.contains('btn-primary') || el.classList.contains('fab')) confirmTick();
      else tapTick();
    };

    const onPointerDown = (e) => {
      const el = e.target.closest?.(
        'button, a, [role="button"], [role="switch"], input[type="checkbox"], input[type="radio"]'
      );
      if (!el || el.disabled) return;
      pending = { el, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
    };
    const onPointerMove = (e) => {
      if (!pending || e.pointerId !== pending.pointerId) return;
      const dx = e.clientX - pending.startX;
      const dy = e.clientY - pending.startY;
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) pending = null;
    };
    const onPointerUp = (e) => {
      if (!pending || e.pointerId !== pending.pointerId) return;
      fireForElement(pending.el);
      pending = null;
    };
    const onPointerCancel = (e) => {
      if (pending && e.pointerId === pending.pointerId) pending = null;
    };

    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerup', onPointerUp, { passive: true });
    document.addEventListener('pointercancel', onPointerCancel, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
    };
  }, []);

  // Toggle switches (and other small controls deep in a scrollable settings
  // list) can be left focused after a tap; some mobile browsers then try to
  // keep the focused element in its "preferred" scroll position, which reads
  // as the whole page jumping. Blurring right after the tap avoids that.
  useEffect(() => {
    const onClick = (e) => {
      const el = e.target.closest?.('[role="switch"], .toggle, .seg-btn, .scheme-dot, .step-btn');
      if (el) requestAnimationFrame(() => el.blur());
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // Sticky page headers fade in a solid backdrop once there's content
  // scrolled underneath them (see `body.is-scrolled .page-head::before`).
  // Every page shares the same header, and the window is the scroller, so
  // one passive listener here beats threading a hook through 14 pages.
  // Re-runs per route so a freshly opened page starts flat, and reads the
  // scroll position immediately in case the browser restored it.
  useEffect(() => {
    const onScroll = () => {
      document.body.classList.toggle('is-scrolled', window.scrollY > 4);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.body.classList.remove('is-scrolled');
    };
  }, [location.pathname]);

  // There is no launch splash. The app is what you get on the first paint —
  // the inline boot script in index.html has already resolved the theme, so
  // there's nothing to cover up while it settles and nothing to wait out.
  //
  // Replay requested from Settings. Held here rather than in MorePage so the
  // first run and a replay go through exactly one code path.
  const [replayTour, setReplayTour] = useState(false);

  // The tour narrates the Home screen, so both the first run and a replay
  // from Settings put you there before it starts — otherwise it plays over
  // whichever page you happened to be on and describes something else.
  const showTour = replayTour || !state.settings?.tutorialSeen;
  useEffect(() => {
    if (location.state?.replayTour) {
      setReplayTour(true);
      window.history.replaceState({}, '');
    }
  }, [location]);
  useEffect(() => {
    if (showTour && location.pathname !== '/') navigate('/', { replace: true });
  }, [showTour, location.pathname, navigate]);

  // Apply the selected theme to the document root.
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark =
        theme === 'dark' ||
        (theme === 'system' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.dataset.theme = dark ? 'dark' : 'light';
      // Matches the pre-paint boot script in index.html, which sets this for
      // the first frame; this keeps it right when the theme changes later.
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', dark ? '#0f141a' : '#eef1f4');
    };
    apply();
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);

  // Apply the chosen color scheme (Pro feature; 'default' needs no override).
  const colorScheme = state.settings?.colorScheme || 'default';
  useEffect(() => {
    document.documentElement.dataset.scheme = colorScheme;
  }, [colorScheme]);

  // Keep the time/week-start display prefs (More → Calendar settings) in
  // sync with the small set of pure helpers that format times and compute
  // week boundaries throughout the app.
  const use24h = !!state.settings?.use24h;
  const sundayStart = !!state.settings?.weekStartsSunday;
  const hapticsEnabled = state.settings?.hapticsEnabled ?? true;
  useEffect(() => {
    setHapticsEnabled(hapticsEnabled);
  }, [hapticsEnabled]);
  useEffect(() => {
    setUse24hFormat(use24h);
  }, [use24h]);
  useEffect(() => {
    setSundayWeekStart(sundayStart);
  }, [sundayStart]);

  return (
    <div className="app">
      {CLERK_ENABLED && <SubscriptionSync />}
      {CLERK_ENABLED && <DataSync />}
      <ArrivalWatch />
      <main className="app-main" key={location.pathname}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/goals/:id/history" element={<GoalHistoryPage />} />
          <Route path="/planner" element={<PlannerPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/contacts/:id" element={<ContactDetailPage />} />
          <Route path="/contacts/:id/timeline" element={<ContactTimelinePage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/plan-day" element={<RoutePlannerPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="/shared-calendars" element={<SharedCalendarsPage />} />
          <Route path="/shared-calendars/join/:token" element={<SharedCalendarJoinPage />} />
          <Route path="/shared-calendars/:id" element={<SharedCalendarDetailPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TabBar />
      {/* Same guard as the sync components: it calls useAuth(), which needs
          a ClerkProvider above it. */}
      {CLERK_ENABLED && <AssistantBubble />}
      {showTour && (
        <Tutorial
          onDone={() => {
            setReplayTour(false);
            actions.setSettings({ tutorialSeen: true });
          }}
        />
      )}
    </div>
  );
}
