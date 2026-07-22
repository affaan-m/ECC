// Best-effort local reminders for a serverless PWA.
//
// A PWA with no backend can only raise notifications while it is running (open
// or briefly backgrounded) — it cannot wake a fully-closed app the way a native
// app can, since that needs a push server. This module handles permission and a
// lightweight in-app scheduler that fires due reminders while Keystone is open.

import { todayISO, timeToMinutes, matchesRule, formatTime } from './helpers.js';

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : 'denied';
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

function notify(title, body) {
  if (notificationPermission() !== 'granted') return;
  try {
    // Prefer the service worker registration so notifications survive when the
    // page is backgrounded; fall back to a page-level Notification.
    if (navigator.serviceWorker?.ready) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(title, { body, icon: `${import.meta.env.BASE_URL}icon.svg`, badge: `${import.meta.env.BASE_URL}icon.svg` }))
        .catch(() => new Notification(title, { body }));
    } else {
      new Notification(title, { body });
    }
  } catch {
    /* ignore — notifications are a best-effort enhancement */
  }
}

// De-dupe fired reminders per day so we never buzz twice for the same thing.
const FIRED_KEY = 'compass.firedReminders';
function loadFired() {
  try {
    const raw = JSON.parse(localStorage.getItem(FIRED_KEY) || '{}');
    return raw.day === todayISO() ? new Set(raw.keys) : new Set();
  } catch {
    return new Set();
  }
}
function saveFired(set) {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify({ day: todayISO(), keys: [...set] }));
  } catch {
    /* ignore */
  }
}

// Scan goals and events for reminders that are due right now (within the last
// few minutes) and haven't fired yet today.
export function runReminderScan(state) {
  if (notificationPermission() !== 'granted') return;
  if (!state.settings?.notifications) return;

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = todayISO();
  const fired = loadFired();
  let changed = false;

  const fire = (key, title, body) => {
    if (fired.has(key)) return;
    notify(title, body);
    fired.add(key);
    changed = true;
  };

  // Goal reminders: a fixed time-of-day nudge, if the goal isn't already met.
  for (const g of state.goals || []) {
    const time = g.reminder?.time;
    if (!time) continue;
    const due = timeToMinutes(time);
    if (nowMin >= due && nowMin - due <= 30) {
      if (g.period === 'daily' && (g.progress?.[today] || 0) >= g.target) continue; // met
      fire(`goal:${g.id}:${today}`, 'Goal reminder', `Time for: ${g.title}`);
    }
  }

  // Event reminders: fire `reminder` minutes before an occurrence's start.
  for (const e of state.events || []) {
    const lead = Number(e.reminder) || 0;
    if (!lead) continue;
    if (!matchesRule(e, today) || (e.skipDates || []).includes(today)) continue;
    const start = timeToMinutes(e.start);
    const trigger = start - lead;
    if (nowMin >= trigger && nowMin <= start) {
      fire(
        `event:${e.id}:${today}`,
        e.title || 'Upcoming event',
        `Starts at ${formatTime(e.start)}${lead ? ` · in ${lead} min` : ''}`
      );
    }
  }

  if (changed) saveFired(fired);
}
