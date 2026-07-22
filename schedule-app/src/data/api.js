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
    throw new Error(errBody.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const fetchMe = (getToken) => request('/api/me', { getToken });
export const startCheckout = (getToken, plan) =>
  request('/api/billing/checkout', { getToken, method: 'POST', body: { plan } });
export const openBillingPortal = (getToken) => request('/api/billing/portal', { getToken, method: 'POST' });

export const backendConfigured = () => !!BASE_URL;
