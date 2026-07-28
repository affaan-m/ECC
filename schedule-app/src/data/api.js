// Thin client for the Keystone backend (accounts + billing). Every call
// needs a fresh Clerk session token, so callers pass their own `getToken`
// (from Clerk's useAuth()) rather than this module holding one itself.
const BASE_URL = import.meta.env.VITE_BACKEND_URL || '';

async function request(path, { getToken, method = 'GET', body } = {}) {
  if (!BASE_URL) throw new Error('Backend not configured (VITE_BACKEND_URL missing).');
  const token = await getToken?.();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(errBody.error || `Request failed (${res.status})`);
    // Callers that need to tell "this is off" from "this went wrong" — the
    // assistant hides its bubble on one and shows a message on the other.
    err.status = res.status;
    err.code = errBody.code;
    throw err;
  }
  return res.json();
}

export const fetchMe = (getToken) => request('/api/me', { getToken });
// Pro is a single one-time purchase, so there's no plan to choose — the
// server holds the only price.
export const startCheckout = (getToken) =>
  request('/api/billing/checkout', { getToken, method: 'POST' });
export const openBillingPortal = (getToken) => request('/api/billing/portal', { getToken, method: 'POST' });

// Whole-app-data sync: mirrors the same object shape kept in localStorage.
export const fetchSyncedData = (getToken) => request('/api/data', { getToken });
export const pushSyncedData = (getToken, data) =>
  request('/api/data', { getToken, method: 'PUT', body: { data } });

// The assistant. One turn per call: post the conversation so far (plus a
// plain-text digest of the user's schedule) and get back one Claude message,
// which may ask for tools to be run. The tools themselves run in the browser
// — see data/assistantTools.js — so this stays a single request/response and
// the API key never leaves the server.
export const assistantAvailable = (getToken) => request('/api/assistant', { getToken });
export const askAssistant = (getToken, messages, context) =>
  request('/api/assistant', { getToken, method: 'POST', body: { messages, context } });

// Shared calendars — invite someone to see/add simple events with you.
// Backend-only feature (see backend/README.md's "Known gaps" section for
// what still needs deploying before these calls will succeed).
export const fetchCalendars = (getToken) => request('/api/calendars', { getToken });
export const createCalendar = (getToken, name, color) =>
  request('/api/calendars', { getToken, method: 'POST', body: { name, color } });
export const fetchCalendar = (getToken, id) => request(`/api/calendars/${id}`, { getToken });
export const renameCalendar = (getToken, id, patch) =>
  request(`/api/calendars/${id}`, { getToken, method: 'PATCH', body: patch });
export const deleteCalendar = (getToken, id) =>
  request(`/api/calendars/${id}`, { getToken, method: 'DELETE' });
export const removeCalendarMember = (getToken, id, memberId) =>
  request(`/api/calendars/${id}/members/${memberId}`, { getToken, method: 'DELETE' });
export const fetchCalendarInvites = (getToken, id) =>
  request(`/api/calendars/${id}/invites`, { getToken });
export const inviteToCalendar = (getToken, id, email, role) =>
  request(`/api/calendars/${id}/invites`, { getToken, method: 'POST', body: { email, role } });
export const revokeCalendarInvite = (getToken, id, inviteId) =>
  request(`/api/calendars/${id}/invites/${inviteId}`, { getToken, method: 'DELETE' });
export const acceptCalendarInvite = (getToken, token) =>
  request(`/api/calendars/invites/${token}/accept`, { getToken, method: 'POST' });
export const addSharedEvent = (getToken, id, event) =>
  request(`/api/calendars/${id}/events`, { getToken, method: 'POST', body: event });
export const updateSharedEvent = (getToken, id, eventId, patch) =>
  request(`/api/calendars/${id}/events/${eventId}`, { getToken, method: 'PATCH', body: patch });
export const deleteSharedEvent = (getToken, id, eventId) =>
  request(`/api/calendars/${id}/events/${eventId}`, { getToken, method: 'DELETE' });

export const backendConfigured = () => !!BASE_URL;
