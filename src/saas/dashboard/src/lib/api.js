/**
 * API client — wraps all fetch calls to the backend.
 * Token is stored in localStorage (set on login).
 */

const BASE = import.meta.env.VITE_API_URL || '';

function getToken() {
  return localStorage.getItem('ira_token') || '';
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  get:   (path)         => request('GET', path),
  post:  (path, body)   => request('POST', path, body),
  patch: (path, body)   => request('PATCH', path, body),

  setToken: (token) => localStorage.setItem('ira_token', token),
  clearToken: ()    => localStorage.removeItem('ira_token'),
  hasToken: ()      => Boolean(getToken()),
};
