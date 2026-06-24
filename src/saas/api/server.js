'use strict';

/**
 * Incident Response SaaS — API Server
 *
 * Start: node src/saas/api/server.js
 * Env:   DATABASE_URL, JWT_SECRET, PORT (default 3000)
 *
 * Routes:
 *   POST /webhooks/:token          — ingest alerts (no auth, token = credential)
 *   GET  /incidents                — list incidents (auth required)
 *   GET  /incidents/:id            — get incident (auth required)
 *   POST /incidents                — create manually (auth required)
 *   PATCH /incidents/:id           — update (auth required)
 *   GET  /incidents/:id/events     — timeline (auth required)
 *   POST /incidents/:id/events     — add comment (auth required)
 *   POST /incidents/:id/resolve    — resolve (auth required)
 *   GET  /health                   — health check (no auth)
 */

const http = require('http');
const { requireAuth, requireScope } = require('../middleware/auth');
const { handleWebhook } = require('../routes/webhooks');
const incidents = require('../routes/incidents');

const PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_BODY_BYTES = 64 * 1024;

// ─── Request parsing ──────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;

    req.setEncoding('utf8');
    req.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────

function matchRoute(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);

  if (method === 'GET' && pathname === '/health') return { handler: 'health' };

  if (method === 'POST' && parts[0] === 'webhooks' && parts[1]) {
    return { handler: 'webhook', params: { token: parts[1] } };
  }

  if (parts[0] === 'incidents') {
    if (parts.length === 1) {
      if (method === 'GET') return { handler: 'listIncidents', auth: true };
      if (method === 'POST') return { handler: 'createIncident', auth: true };
    }
    if (parts.length === 2) {
      if (method === 'GET')   return { handler: 'getIncident',    auth: true, params: { id: parts[1] } };
      if (method === 'PATCH') return { handler: 'updateIncident', auth: true, params: { id: parts[1] } };
    }
    if (parts.length === 3 && parts[2] === 'events') {
      if (method === 'GET')  return { handler: 'getEvents', auth: true, params: { id: parts[1] } };
      if (method === 'POST') return { handler: 'addEvent',  auth: true, params: { id: parts[1] } };
    }
    if (parts.length === 3 && parts[2] === 'resolve') {
      if (method === 'POST') return { handler: 'resolveIncident', auth: true, params: { id: parts[1] } };
    }
  }

  return null;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function makeRes(nodeRes) {
  return {
    _headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
    status(code) { this._code = code; return this; },
    json(body) {
      nodeRes.writeHead(this._code || 200, this._headers);
      nodeRes.end(JSON.stringify(body));
    },
    _code: 200,
  };
}

// ─── Main request handler ─────────────────────────────────────────────────────

async function handleRequest(nodeReq, nodeRes) {
  const url = new URL(nodeReq.url || '/', `http://localhost:${PORT}`);
  const method = nodeReq.method || 'GET';
  const pathname = url.pathname;

  const res = makeRes(nodeRes);

  // Security headers on every response
  nodeRes.setHeader('X-Frame-Options', 'DENY');
  nodeRes.setHeader('X-Content-Type-Options', 'nosniff');
  nodeRes.setHeader('Referrer-Policy', 'no-referrer');

  let body = {};
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    try {
      body = await parseBody(nodeReq);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const route = matchRoute(method, pathname);

  if (!route) {
    return res.status(404).json({ error: 'Not found' });
  }

  // Attach parsed data to a minimal req-like object
  const req = {
    method,
    headers: nodeReq.headers,
    params: route.params || {},
    query: Object.fromEntries(url.searchParams),
    body,
    org: null,
    user: null,
    authType: null,
    scopes: [],
  };

  // Health check — no auth
  if (route.handler === 'health') {
    return res.json({ status: 'ok', ts: new Date().toISOString() });
  }

  // Webhook — no auth header, token is in URL
  if (route.handler === 'webhook') {
    return handleWebhook(req, res);
  }

  // All other routes require authentication
  await new Promise((resolve) => requireAuth(req, res, resolve));
  if (!req.org) return; // requireAuth already responded

  const handlers = {
    listIncidents:   incidents.listIncidents,
    getIncident:     incidents.getIncident,
    createIncident:  incidents.createIncident,
    updateIncident:  incidents.updateIncident,
    getEvents:       incidents.getEvents,
    addEvent:        incidents.addEvent,
    resolveIncident: incidents.resolveIncident,
  };

  const fn = handlers[route.handler];
  if (!fn) return res.status(404).json({ error: 'Not found' });

  try {
    await fn(req, res);
  } catch (err) {
    process.stderr.write(`[Server] Unhandled error in ${route.handler}: ${err.message}\n`);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    process.stderr.write('[Server] ERROR: DATABASE_URL is required\n');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    process.stderr.write('[Server] ERROR: JWT_SECRET is required\n');
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      process.stderr.write(`[Server] Fatal: ${err.message}\n`);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    });
  });

  server.listen(PORT, () => {
    process.stdout.write(`[Server] Incident Response API running on port ${PORT}\n`);
  });
}

module.exports = { handleRequest };
