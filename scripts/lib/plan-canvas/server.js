'use strict';

/**
 * Plan Canvas loopback server.
 *
 * One detached process serves every open review session: the browser chrome,
 * the rendered artifact, an SSE stream for live updates, and the long-poll
 * endpoint agents block on. Sessions are keyed by canonical artifact path
 * (see sessions.js).
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const http = require('http');
const path = require('path');

const { buildAllowedHostnames, isAllowedHostHeader, isAllowedOrigin } = require('../loopback-guard');
const { renderMarkdown } = require('./markdown');
const { artifactSdkJs } = require('./sdk');
const {
  canvasCss,
  canvasClientJs,
  renderCanvasHtml,
  renderMarkdownArtifactHtml,
  renderSessionListHtml
} = require('./ui');

const DEFAULT_PORT = 4517;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function resolvePort(env = process.env) {
  const value = Number.parseInt(env.ECC_PLAN_CANVAS_PORT || '', 10);
  return Number.isInteger(value) && value >= 0 && value <= 65535 ? value : DEFAULT_PORT;
}

function resolveIdleTimeoutMs(env = process.env) {
  const raw = String(env.ECC_PLAN_CANVAS_IDLE_MS || '').trim().toLowerCase();
  if (raw === '0' || raw === 'off') return 0;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_IDLE_TIMEOUT_MS;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function sendHtml(res, statusCode, html, { csp = true } = {}) {
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (csp) {
    headers['content-security-policy'] =
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'";
  }
  res.writeHead(statusCode, headers);
  res.end(html);
}

function createPlanCanvasServer({
  store,
  host = DEFAULT_HOST,
  version = '0.0.0',
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  heartbeatMs = 15000,
  onIdleShutdown = null,
  log = () => {}
} = {}) {
  if (!store) throw new Error('createPlanCanvasServer requires a session store');

  const allowedHostnames = buildAllowedHostnames(host);
  const wake = new EventEmitter();
  wake.setMaxListeners(0);
  const sseClients = new Map(); // key -> Set<res>
  const awaitCounts = new Map(); // key -> active long-poll count
  const workingKeys = new Set(); // keys whose agent took feedback and is off working
  const watchers = new Map(); // key -> fs.FSWatcher
  let idleTimer = null;
  let closed = false;

  // --- presence + SSE ---------------------------------------------------

  function presenceFor(key) {
    const session = store.get(key);
    if (!session || session.status === 'ended') return 'ended';
    if ((awaitCounts.get(key) || 0) > 0) return 'listening';
    return workingKeys.has(key) ? 'working' : 'waiting';
  }

  function broadcast(key, event, payload) {
    const clients = sseClients.get(key);
    if (!clients) return;
    const frameText = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) client.write(frameText);
  }

  function broadcastPresence(key) {
    broadcast(key, 'presence', { state: presenceFor(key) });
  }

  function connectionCount() {
    let total = 0;
    for (const clients of sseClients.values()) total += clients.size;
    for (const count of awaitCounts.values()) total += count;
    return total;
  }

  function armIdleTimer() {
    if (!idleTimeoutMs || closed) return;
    if (connectionCount() > 0) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (connectionCount() === 0 && !closed) {
        log('[plan-canvas] idle timeout reached, shutting down');
        if (onIdleShutdown) onIdleShutdown();
      }
    }, idleTimeoutMs);
    if (idleTimer.unref) idleTimer.unref();
  }

  function noteConnectionOpened() {
    clearTimeout(idleTimer);
  }

  function noteConnectionClosed() {
    armIdleTimer();
  }

  // --- artifact watching --------------------------------------------------

  function watchSession(session) {
    if (watchers.has(session.key)) return;
    const dir = path.dirname(session.file);
    const base = path.basename(session.file);
    let debounce = null;
    try {
      const watcher = fs.watch(dir, (eventType, filename) => {
        if (filename && filename !== base) return;
        clearTimeout(debounce);
        debounce = setTimeout(() => broadcast(session.key, 'reload', {}), 150);
      });
      watcher.on('error', () => watchers.delete(session.key));
      watchers.set(session.key, watcher);
    } catch {
      // Watching is best-effort; manual reload still works.
    }
  }

  function unwatchSession(key) {
    const watcher = watchers.get(key);
    if (watcher) {
      watcher.close();
      watchers.delete(key);
    }
  }

  // --- session actions ------------------------------------------------------

  function endSession(key, endedBy) {
    const session = store.end(key, endedBy);
    if (!session) return null;
    wake.emit(`wake:${key}`);
    broadcast(key, 'ended', { endedBy: session.endedBy });
    broadcastPresence(key);
    unwatchSession(key);
    return session;
  }

  // --- request handlers -------------------------------------------------------

  async function handleApi(req, res, url) {
    const { pathname } = url;

    if (req.method === 'POST' && pathname === '/api/sessions') {
      const body = await readJsonBody(req);
      if (!body.file || typeof body.file !== 'string') {
        return sendJson(res, 400, { error: 'file is required' });
      }
      if (!fs.existsSync(path.resolve(body.file))) {
        return sendJson(res, 404, { error: `artifact not found: ${body.file}` });
      }
      const { session, refused } = store.open(body.file, { reopen: Boolean(body.reopen) });
      if (refused) {
        return sendJson(res, 409, {
          status: 'user-ended',
          key: session.key,
          next_step: 'The user ended this review from the browser. Do not reopen it unless they ask; pass reopen:true when they do.'
        });
      }
      watchSession(session);
      broadcastPresence(session.key);
      return sendJson(res, 200, {
        status: 'open',
        key: session.key,
        file: session.file,
        url: `/canvas/${session.key}`
      });
    }

    if (req.method === 'GET' && pathname === '/api/sessions') {
      return sendJson(res, 200, { sessions: store.list() });
    }

    if (req.method === 'GET' && pathname === '/api/await') {
      const keyParam = url.searchParams.get('key');
      const file = url.searchParams.get('file');
      if (keyParam && !/^[a-f0-9]{12}$/.test(keyParam)) return sendJson(res, 400, { error: 'invalid session key' });
      if (!keyParam && !file) return sendJson(res, 400, { error: 'key or file query parameter is required' });
      const session = keyParam ? store.get(keyParam) : store.findByFile(file);
      if (!session) return sendJson(res, 200, { status: 'missing' });
      const key = session.key;
      const timeoutRaw = url.searchParams.get('timeoutMs');
      const timeoutMs = timeoutRaw === null ? null : Math.max(0, Number.parseInt(timeoutRaw, 10) || 0);

      const first = store.takeFeedback(key);
      if (first.status !== 'waiting') {
        if (first.status === 'feedback') workingKeys.add(key);
        broadcastPresence(key);
        return sendJson(res, 200, first);
      }

      // Long poll: hold the request open until feedback or session end.
      noteConnectionOpened();
      awaitCounts.set(key, (awaitCounts.get(key) || 0) + 1);
      workingKeys.delete(key);
      broadcastPresence(key);

      let settled = false;
      let heartbeat = null;
      let waitTimer = null;
      const finish = payload => {
        if (settled) return;
        settled = true;
        cleanup();
        if (payload) {
          if (payload.status === 'feedback') workingKeys.add(key);
          res.end(JSON.stringify(payload));
        }
        broadcastPresence(key);
        noteConnectionClosed();
      };
      const onWake = () => {
        const result = store.takeFeedback(key);
        if (result.status !== 'waiting') finish(result);
      };
      // Settle held polls on shutdown so server.close() can complete; the
      // CLI tells agents to simply re-run await.
      const onServerClose = () =>
        finish({ status: 'waiting', note: 'canvas server is shutting down; re-run await' });
      const cleanup = () => {
        wake.removeListener(`wake:${key}`, onWake);
        wake.removeListener('server-close', onServerClose);
        clearInterval(heartbeat);
        clearTimeout(waitTimer);
        awaitCounts.set(key, Math.max(0, (awaitCounts.get(key) || 1) - 1));
      };

      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      // Leading whitespace keeps the connection visibly alive without
      // corrupting the JSON payload written at the end.
      res.write(' ');
      heartbeat = setInterval(() => {
        if (!settled) res.write(' ');
      }, heartbeatMs);
      if (timeoutMs !== null) {
        waitTimer = setTimeout(() => finish({ status: 'waiting' }), timeoutMs);
      }
      wake.on(`wake:${key}`, onWake);
      wake.once('server-close', onServerClose);
      req.on('close', () => finish(null));
      return undefined;
    }

    if (req.method === 'POST' && pathname === '/api/end') {
      const body = await readJsonBody(req);
      if (!body.file || typeof body.file !== 'string') {
        return sendJson(res, 400, { error: 'file is required' });
      }
      const session = store.findByFile(body.file);
      if (!session) return sendJson(res, 404, { error: 'no session for that file' });
      endSession(session.key, 'agent');
      return sendJson(res, 200, { status: 'ended', endedBy: 'agent' });
    }

    const sessionMatch = pathname.match(/^\/api\/session\/([a-f0-9]{12})\/(feedback|end|reply)$/);
    if (sessionMatch && req.method === 'POST') {
      const [, key, action] = sessionMatch;
      const session = store.get(key);
      if (!session) return sendJson(res, 404, { error: 'unknown session' });

      if (action === 'feedback') {
        const body = await readJsonBody(req);
        const result = store.queueFeedback(key, body.items, { endSession: Boolean(body.endSession) });
        if (!result) return sendJson(res, 409, { error: 'session already ended' });
        wake.emit(`wake:${key}`);
        broadcast(key, 'chat-sync', { chat: store.get(key).chat });
        if (body.endSession) broadcast(key, 'ended', { endedBy: 'user' });
        return sendJson(res, 200, { status: 'queued', accepted: result.accepted.length, pending: result.pending });
      }

      if (action === 'end') {
        endSession(key, 'user');
        return sendJson(res, 200, { status: 'ended', endedBy: 'user' });
      }

      if (action === 'reply') {
        const body = await readJsonBody(req);
        if (!body.text || typeof body.text !== 'string') {
          return sendJson(res, 400, { error: 'text is required' });
        }
        const entry = store.addAgentReply(key, body.text);
        broadcast(key, 'chat-sync', { chat: store.get(key).chat });
        return sendJson(res, 200, { status: 'sent', at: entry.at });
      }
    }

    return sendJson(res, 404, { error: 'not found' });
  }

  function handleEvents(req, res, key) {
    const session = store.get(key);
    if (!session) return sendJson(res, 404, { error: 'unknown session' });
    noteConnectionOpened();
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive'
    });
    res.write(`event: chat-sync\ndata: ${JSON.stringify({ chat: session.chat })}\n\n`);
    res.write(`event: presence\ndata: ${JSON.stringify({ state: presenceFor(key) })}\n\n`);
    if (!sseClients.has(key)) sseClients.set(key, new Set());
    sseClients.get(key).add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    if (ping.unref) ping.unref();
    req.on('close', () => {
      clearInterval(ping);
      const clients = sseClients.get(key);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) sseClients.delete(key);
      }
      noteConnectionClosed();
    });
  }

  function serveArtifact(res, key, assetPath) {
    const session = store.get(key);
    if (!session) return sendHtml(res, 404, '<h1>Unknown session</h1>');

    if (!assetPath) {
      let content;
      try {
        content = fs.readFileSync(session.file, 'utf8');
      } catch {
        return sendHtml(res, 404, `<h1>Artifact missing</h1><p>${session.file} no longer exists.</p>`, { csp: false });
      }
      const ext = path.extname(session.file).toLowerCase();
      if (ext === '.md' || ext === '.markdown') {
        const html = renderMarkdownArtifactHtml(renderMarkdown(content), {
          title: path.basename(session.file),
          sdkSrc: '/sdk.js'
        });
        return sendHtml(res, 200, html, { csp: false });
      }
      const sdkTag = '<script src="/sdk.js"></script>';
      const injected = content.includes('</body>')
        ? content.replace('</body>', `${sdkTag}\n</body>`)
        : `${content}\n${sdkTag}`;
      return sendHtml(res, 200, injected, { csp: false });
    }

    // Sibling assets resolve relative to the artifact's directory and must
    // stay confined to it.
    const baseDir = path.dirname(session.file);
    const resolved = path.resolve(baseDir, assetPath);
    if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
      return sendJson(res, 403, { error: 'asset path escapes artifact directory' });
    }
    let data;
    try {
      data = fs.readFileSync(resolved);
    } catch {
      return sendJson(res, 404, { error: 'asset not found' });
    }
    const type = CONTENT_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    return res.end(data);
  }

  const server = http.createServer((req, res) => {
    if (!isAllowedHostHeader(req.headers.host, allowedHostnames)) {
      return sendJson(res, 403, { error: 'forbidden host header' });
    }
    if (!isAllowedOrigin(req.headers.origin, allowedHostnames)) {
      return sendJson(res, 403, { error: 'forbidden origin' });
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = url;

    Promise.resolve()
      .then(() => {
        if (req.method === 'GET' && pathname === '/health') {
          return sendJson(res, 200, { ok: true, app: 'ecc-plan-canvas', version });
        }
        if (req.method === 'POST' && pathname === '/shutdown') {
          sendJson(res, 200, { status: 'stopping' });
          setImmediate(() => {
            if (onIdleShutdown) onIdleShutdown();
          });
          return undefined;
        }
        if (req.method === 'GET' && pathname === '/') {
          return sendHtml(res, 200, renderSessionListHtml(store.list()));
        }
        if (req.method === 'GET' && pathname === '/canvas.css') {
          res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(canvasCss());
        }
        if (req.method === 'GET' && pathname === '/client.js') {
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(canvasClientJs());
        }
        if (req.method === 'GET' && pathname === '/sdk.js') {
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(artifactSdkJs());
        }
        const canvasMatch = pathname.match(/^\/canvas\/([a-f0-9]{12})$/);
        if (req.method === 'GET' && canvasMatch) {
          const session = store.get(canvasMatch[1]);
          if (!session) return sendHtml(res, 404, '<h1>Unknown session</h1>');
          return sendHtml(res, 200, renderCanvasHtml(session));
        }
        const eventsMatch = pathname.match(/^\/events\/([a-f0-9]{12})$/);
        if (req.method === 'GET' && eventsMatch) {
          return handleEvents(req, res, eventsMatch[1]);
        }
        const artifactMatch = pathname.match(/^\/artifact\/([a-f0-9]{12})\/(.*)$/);
        if (req.method === 'GET' && artifactMatch) {
          const assetPath = decodeURIComponent(artifactMatch[2]);
          return serveArtifact(res, artifactMatch[1], assetPath || null);
        }
        if (pathname.startsWith('/api/')) {
          return handleApi(req, res, url);
        }
        return sendJson(res, 404, { error: 'not found' });
      })
      .catch(error => {
        if (!res.headersSent) sendJson(res, 400, { error: error.message });
        else res.end();
      });
  });

  function close() {
    closed = true;
    clearTimeout(idleTimer);
    for (const key of watchers.keys()) unwatchSession(key);
    for (const clients of sseClients.values()) {
      for (const client of clients) client.end();
    }
    sseClients.clear();
    wake.emit('server-close');
    return new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
      // Browser keep-alive sockets would otherwise hold close() open.
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    });
  }

  function listen(port = resolvePort()) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        armIdleTimer();
        resolve({ port: server.address().port, host });
      });
    });
  }

  return { server, listen, close, presenceFor, watchSession };
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  createPlanCanvasServer,
  resolveIdleTimeoutMs,
  resolvePort
};
