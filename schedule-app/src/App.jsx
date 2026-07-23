import { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import TabBar from './components/TabBar.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import Tutorial from './components/Tutorial.jsx';
import { runReminderScan } from './data/notifications.js';
import { tapTick, confirmTick, warnTick } from './data/haptics.js';
import { setUse24hFormat, setSundayWeekStart } from './data/helpers.js';
import { setHapticsEnabled } from './data/haptics.js';
import { fetchMe, backendConfigured, fetchSyncedData, pushSyncedData } from './data/api.js';
import { CLERK_ENABLED } from './data/clerkConfig.js';
import HomePage from './pages/HomePage.jsx';
import GoalsPage from './pages/GoalsPage.jsx';
import PlannerPage from './pages/PlannerPage.jsx';
import ContactsPage from './pages/ContactsPage.jsx';
import ContactDetailPage from './pages/ContactDetailPage.jsx';
import ContactTimelinePage from './pages/ContactTimelinePage.jsx';
import MapPage from './pages/MapPage.jsx';
import MorePage from './pages/MorePage.jsx';
import PricingPage from './pages/PricingPage.jsx';
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
  // at the SAME strength as a save/delete), not tapping in general.
  useEffect(() => {
    const onPointerDown = (e) => {
      const el = e.target.closest?.(
        'button, [role="switch"], input[type="checkbox"], input[type="radio"]'
      );
      if (!el || el.disabled) return;
      // The day timeline's event blocks run their own long-press-to-arm gesture
      // with its own haptics (see PlannerPage) — a delegated tap here on every
      // pointerdown would double up with (and pre-empt) that feedback.
      if (el.classList.contains('event-block')) return;
      if (el.classList.contains('btn-danger') || el.classList.contains('btn-danger-ghost')) warnTick();
      else if (el.classList.contains('btn-primary') || el.classList.contains('fab')) confirmTick();
      else tapTick();
    };
    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onPointerDown);
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

  // Launch splash: hold the mark on screen briefly, then fade it away.
  const [showSplash, setShowSplash] = useState(true);
  const [splashOut, setSplashOut] = useState(false);
  useEffect(() => {
    const outTimer = setTimeout(() => setSplashOut(true), 500);
    const removeTimer = setTimeout(() => setShowSplash(false), 900);
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
      <main className="app-main" key={location.pathname}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/planner" element={<PlannerPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/contacts/:id" element={<ContactDetailPage />} />
          <Route path="/contacts/:id/timeline" element={<ContactTimelinePage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="/pricing" element={<PricingPage />} />
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
