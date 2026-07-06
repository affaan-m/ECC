'use strict';

/**
 * Host/Origin gating for ECC's loopback HTTP servers (control pane, plan
 * canvas). DNS rebinding can point an attacker-controlled hostname at
 * 127.0.0.1, so every request must present a Host header from this
 * allowlist before the server does any work.
 */

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

// Extract the hostname portion of an HTTP Host header value, stripping any
// port. Returns null when the header is missing or malformed.
function parseHostHeader(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\[[^\]]+\]|[^:]+)(?::\d+)?$/);
  if (!match) return null;
  return match[1].toLowerCase();
}

function buildAllowedHostnames(configuredHost) {
  const set = new Set(LOOPBACK_HOSTNAMES);
  if (configuredHost) set.add(String(configuredHost).toLowerCase());
  return set;
}

function isAllowedHostHeader(hostHeader, allowedHostnames) {
  const hostname = parseHostHeader(hostHeader);
  if (!hostname) return false;
  return allowedHostnames.has(hostname);
}

// Origin is absent on same-origin navigations and CLI clients; when present
// it must resolve to an allowed hostname.
function isAllowedOrigin(originHeader, allowedHostnames) {
  if (!originHeader || typeof originHeader !== 'string') return true;
  try {
    const url = new URL(originHeader);
    return allowedHostnames.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

module.exports = {
  LOOPBACK_HOSTNAMES,
  buildAllowedHostnames,
  isAllowedHostHeader,
  isAllowedOrigin,
  parseHostHeader
};
