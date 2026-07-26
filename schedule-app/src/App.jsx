import { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import TabBar from './components/TabBar.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import Tutorial from './components/Tutorial.jsx';
import { runReminderScan, notify, notificationPermission } from './data/notifications.js';
import { tapTick, confirmTick, warnTick, selectTick, successTick } from './data/haptics.js';
import { setUse24hFormat, setSundayWeekStart, distanceMeters } from './data/helpers.js';
import { setHapticsEnabled } from './data/haptics.js';
import { fetchMe, backendConfigured, fetchSyncedData, pushSyncedData } from './data/api.js';
import { CLERK_ENABLED } from './data/clerkConfig.js';
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
        if (!cancelled) actions.setSettings({ isPro: me.isPro, subscriptionStatus: me.subscriptionStatus });
      })
      .catch((err) => console.warn('Failed to sync subscription status:', err.message));
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// Syncs the whole app data blob (goals, events, contacts, notes, ...) to the
// backend when signed in and the user has Cloud sync turned on (More →
// Account & sync). Policy: on activating, pull whatever's saved on the
// server and replace local state with it (the cloud is treated as
// authoritative once something's already up there); if nothing's saved yet,
// push the current local data to seed it. After that, any local change is
// pushed on a short debounce. This is intentionally simple last-write-wins
// sync for one person's own devices, not a conflict-resolving multi-editor
// sync. Only ever mounted when CLERK_ENABLED, so useAuth() always has a
// provider.
function DataSync() {
  const { state } = useStore();
  const actions = useActions();
  const { isSignedIn, getToken } = useAuth();
  const cloudSyncOn = !!state.settings?.cloudSync;
  const isPro = !!state.settings?.isPro;
  const active = isSignedIn && cloudSyncOn && isPro && backendConfigured();

  const pulledRef = useRef(false);
  const skipNextPushRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Initial pull, once per activation (sign-in + toggle-on + Pro all true).
  useEffect(() => {
    if (!active) {
      pulledRef.current = false;
      return;
    }
    if (pulledRef.current) return;
    pulledRef.current = true;
    let cancelled = false;
    fetchSyncedData(getToken)
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          skipNextPushRef.current = true;
          actions.importData(data);
        } else {
          return pushSyncedData(getToken, stateRef.current);
        }
      })
      .catch((err) => console.warn('Cloud sync: initial sync failed:', err.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Debounced push whenever local data changes while sync is active.
  useEffect(() => {
    if (!active) return;
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      pushSyncedData(getToken, state).catch((err) =>
        console.warn('Cloud sync: push failed:', err.message)
      );
    }, 2500);
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

  // Launch splash: the mark builds itself (see SplashScreen.jsx/styles.css
  // for the choreography — arch blocks rise for 650ms, the keystone drops
  // in over the next 380ms, then its glow bursts) before the whole overlay
  // fades away. These timers just need to start that fade once the glow
  // has had a moment to peak, and unmount after the .splash opacity
  // transition (0.4s) has had time to finish.
  const [showSplash, setShowSplash] = useState(true);
  const [splashOut, setSplashOut] = useState(false);
  useEffect(() => {
    const outTimer = setTimeout(() => setSplashOut(true), 1200);
    const removeTimer = setTimeout(() => setShowSplash(false), 1600);
    return () => {
      clearTimeout(outTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  // Apply the selected theme to the document root.
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark =
        theme === 'dark' ||
        (theme === 'system' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.dataset.theme = dark ? 'dark' : 'light';
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
      {showSplash && <SplashScreen fadingOut={splashOut} />}
      {!showSplash && !state.settings?.tutorialSeen && (
        <Tutorial onDone={() => actions.setSettings({ tutorialSeen: true })} />
      )}
    </div>
  );
}
