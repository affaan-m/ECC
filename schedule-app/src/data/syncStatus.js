import { useEffect, useState } from 'react';

// A tiny broadcast channel for what the sync is doing.
//
// The sync itself lives in App.jsx (it has to, to see every state change),
// but the thing that reports on it lives in Settings. Routing that through
// the app's own data store would mean every "syncing…" tick was a state
// change, which would in turn schedule another push — a sync that syncs
// because it synced. So this is kept deliberately outside the store.
let current = { phase: 'idle', at: null, error: null };
const listeners = new Set();

export function setSyncStatus(next) {
  current = { ...current, ...next };
  for (const fn of listeners) fn(current);
}

export function useSyncStatus() {
  const [status, setStatus] = useState(current);
  useEffect(() => {
    listeners.add(setStatus);
    setStatus(current);
    return () => listeners.delete(setStatus);
  }, []);
  return status;
}

// "3 minutes ago" — relative, because the only thing anyone wants from a
// sync timestamp is reassurance that it was recent.
export function describeSyncedAt(at) {
  if (!at) return 'not yet';
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 15) return 'just now';
  if (secs < 90) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
