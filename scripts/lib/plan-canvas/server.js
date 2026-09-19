'use strict';

/**
 * Plan Canvas loopback server.
 *
 * One detached process serves every open review session: the browser chrome,
 * the rendered artifact, finite browser state polling, and the long-poll
 * endpoint agents block on. Sessions are keyed by canonical artifact path
 * (see sessions.js).
 */

const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const { buildAllowedHostnames, isAllowedHostHeader, isAllowedOrigin } = require('../loopback-guard');
const { renderMarkdown } = require('./markdown');
const { exportPdf } = require('./pdf');
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
const MAX_PDF_SNAPSHOT_BYTES = 5 * 1024 * 1024;
// How long the "agent is thinking" indicator survives without the agent
// checking back in, before presence decays to the honest queued/waiting.
const DEFAULT_THINKING_STALE_MS = 90 * 1000;
// An explicit typing signal expires faster: it means "a reply is seconds away".
const DEFAULT_TYPING_EXPIRY_MS = 30 * 1000;
const PLAN_CANVAS_PROTOCOL_VERSION = 4;
const TYPING_STATES = new Set(['thinking', 'typing', 'idle']);
const PDF_EXPORT_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "font-src 'self' data:",
  "form-action 'none'",
  "frame-src 'none'",
  "img-src 'self' data:",
  "media-src 'self' data:",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'self' 'unsafe-inline'"
].join('; ');

// Package versions do not distinguish two worktrees on the same release.
// Fingerprint every module loaded into the detached server so a current CLI
// never reuses stale browser or protocol code from an older checkout.
function computeRuntimeId() {
  const sources = [
    ['loopback-guard.js', path.join(__dirname, '..', 'loopback-guard.js')],
    ['markdown.js', path.join(__dirname, 'markdown.js')],
    ['pdf.js', path.join(__dirname, 'pdf.js')],
    ['sdk.js', path.join(__dirname, 'sdk.js')],
    ['server.js', __filename],
    ['sessions.js', path.join(__dirname, 'sessions.js')],
    ['ui.js', path.join(__dirname, 'ui.js')]
  ];
  const digest = crypto.createHash('sha256');
  for (const [name, sourcePath] of sources) {
    digest.update(name);
    digest.update('\0');
    digest.update(fs.readFileSync(sourcePath));
    digest.update('\0');
  }
  return digest.digest('hex').slice(0, 16);
}

const PLAN_CANVAS_RUNTIME_ID = computeRuntimeId();

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

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
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
    headers['content-security-policy'] = typeof csp === 'string'
      ? csp
      : "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'";
  }
  res.writeHead(statusCode, headers);
  res.end(html);
}

function sendPdf(res, { buffer, filename }) {
  const asciiName = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '-');
  const encodedName = encodeURIComponent(filename).replace(/['()]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  res.writeHead(200, {
    'content-type': 'application/pdf',
    'content-length': buffer.length,
    'content-disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    'x-content-type-options': 'nosniff',
    'x-plan-canvas-filename': encodeURIComponent(filename),
    'cache-control': 'no-store'
  });
  res.end(buffer);
}

function createPlanCanvasServer({
  store,
  host = DEFAULT_HOST,
  version = '0.0.0',
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  heartbeatMs = 15000,
  thinkingStaleMs = DEFAULT_THINKING_STALE_MS,
  typingExpiryMs = DEFAULT_TYPING_EXPIRY_MS,
  pdfExporter = exportPdf,
  onIdleShutdown = null,
  log = () => {}
} = {}) {
  if (!store) throw new Error('createPlanCanvasServer requires a session store');

  const allowedHostnames = buildAllowedHostnames(host);
  const wake = new EventEmitter();
  wake.setMaxListeners(0);
  const awaitCounts = new Map(); // key -> active long-poll count
  const workingKeys = new Map(); // key -> ms timestamp the agent took feedback
  const typingKeys = new Map(); // key -> ms timestamp the agent signalled composing
  let idleTimer = null;
  let closed = false;
  let pdfExportActive = false;
  let pdfSnapshot = null;

  // --- presence ---------------------------------------------------------

  /**
   * Presence never claims more than the server actually knows:
   *
   *   ended     session is closed
   *   typing    agent signalled it is composing a reply (self-expiring)
   *   thinking  agent took the feedback and is working on it (self-expiring)
   *   listening an `await` long poll is parked on this session right now
   *   queued    feedback is sitting undelivered with nobody listening
   *   waiting   nothing queued, nobody listening
   *
   * `thinking` and `typing` expire on their own so a crashed or distracted
   * agent decays to an honest `queued`/`waiting` instead of spinning forever.
   * The old `working` pill had no expiry and no re-broadcast, so it stuck at
   * "agent working" while nothing at all was listening.
   */
  function presenceFor(key, now = Date.now()) {
    const session = store.get(key);
    if (!session || session.status === 'ended') return 'ended';
    const typingAt = typingKeys.get(key);
    if (typingAt !== undefined && now - typingAt < typingExpiryMs) return 'typing';
    const workingAt = workingKeys.get(key);
    if (workingAt !== undefined && now - workingAt < thinkingStaleMs) return 'thinking';
    if ((awaitCounts.get(key) || 0) > 0) return 'listening';
    return session.pendingFeedback && session.pendingFeedback.length > 0 ? 'queued' : 'waiting';
  }

  // The agent is off working on this feedback batch; start the thinking clock.
  function markThinking(key) {
    workingKeys.set(key, Date.now());
    typingKeys.delete(key);
  }

  // A reply landed (or the agent picked the session back up): stop pretending.
  function clearAgentActivity(key) {
    workingKeys.delete(key);
    typingKeys.delete(key);
  }

  function connectionCount() {
    let total = 0;
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

  function artifactVersionFor(session) {
    try {
      const stat = fs.statSync(session.file, { bigint: true });
      return `${stat.mtimeNs}:${stat.size}`;
    } catch {
      return null;
    }
  }

  // --- session actions ------------------------------------------------------

  function endSession(key, endedBy) {
    const session = store.end(key, endedBy);
    if (!session) return null;
    clearAgentActivity(key);
    wake.emit(`wake:${key}`);
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
        if (first.status === 'feedback') markThinking(key);
        return sendJson(res, 200, first);
      }

      // Long poll: hold the request open until feedback or session end.
      noteConnectionOpened();
      awaitCounts.set(key, (awaitCounts.get(key) || 0) + 1);
      clearAgentActivity(key);

      let settled = false;
      let heartbeat = null;
      let waitTimer = null;
      const finish = payload => {
        if (settled) return;
        settled = true;
        cleanup();
        if (payload) {
          if (payload.status === 'feedback') markThinking(key);
          res.end(JSON.stringify(payload));
        }
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

    const stateMatch = pathname.match(/^\/api\/session\/([a-f0-9]{12})\/state$/);
    if (stateMatch && req.method === 'GET') {
      const session = store.get(stateMatch[1]);
      if (!session) return sendJson(res, 404, { error: 'unknown session' });
      // A visible Canvas used to keep the shared server alive through its SSE
      // connection. Preserve that lifecycle with finite polling by restarting
      // the idle clock whenever an active browser reports in.
      armIdleTimer();
      return sendJson(res, 200, {
        status: session.status,
        endedBy: session.endedBy || null,
        chat: session.chat,
        presence: presenceFor(session.key),
        artifactVersion: artifactVersionFor(session)
      });
    }

    const pdfMatch = pathname.match(/^\/api\/session\/([a-f0-9]{12})\/pdf$/);
    if (pdfMatch && (req.method === 'GET' || req.method === 'POST')) {
      const session = store.get(pdfMatch[1]);
      if (!session) return sendJson(res, 404, { error: 'unknown session' });
      const sendBusy = () => {
        res.setHeader('retry-after', '1');
        if (req.method === 'POST') res.setHeader('connection', 'close');
        return sendJson(res, 429, {
          error: 'another PDF export is already in progress',
          code: 'PDF_EXPORT_BUSY'
        });
      };
      // Reject overload before accepting a potentially slow snapshot body.
      if (pdfExportActive) return sendBusy();
      let requestedSnapshot = null;
      if (req.method === 'POST') {
        const body = await readJsonBody(req, MAX_PDF_SNAPSHOT_BYTES);
        if (typeof body.html !== 'string' || !body.html.trim()) {
          return sendJson(res, 400, { error: 'html snapshot is required' });
        }
        requestedSnapshot = { key: session.key, html: body.html };
      }
      // A renderer may have started while this request body was arriving.
      if (pdfExportActive) return sendBusy();
      pdfExportActive = true;
      try {
        pdfSnapshot = requestedSnapshot;
        const pdf = await pdfExporter({
          url: `http://${req.headers.host}/artifact/${session.key}/?pdf=1`,
          artifactFile: session.file
        });
        return sendPdf(res, pdf);
      } catch (error) {
        const code = error.code || 'PDF_EXPORT_FAILED';
        log(`[plan-canvas] PDF export failed (${code}): ${error.stack || error.message}`);
        if (code === 'PDF_BROWSER_NOT_FOUND') {
          return sendJson(res, 503, {
            error: 'PDF export requires Google Chrome, Chromium, or Microsoft Edge; configure ECC_PLAN_CANVAS_CHROME_PATH if auto-discovery cannot find it',
            code
          });
        }
        return sendJson(res, 500, {
          error: 'PDF export failed; check the Plan Canvas server log for details',
          code: 'PDF_EXPORT_FAILED'
        });
      } finally {
        pdfSnapshot = null;
        pdfExportActive = false;
      }
    }

    const sessionMatch = pathname.match(/^\/api\/session\/([a-f0-9]{12})\/(feedback|end|reply|typing)$/);
    if (sessionMatch && req.method === 'POST') {
      const [, key, action] = sessionMatch;
      const session = store.get(key);
      if (!session) return sendJson(res, 404, { error: 'unknown session' });

      if (action === 'feedback') {
        const body = await readJsonBody(req);
        const result = store.queueFeedback(key, body.items, { endSession: Boolean(body.endSession) });
        if (!result) return sendJson(res, 409, { error: 'session already ended' });
        wake.emit(`wake:${key}`);
        // A parked `await` takes the batch synchronously on the wake above, so
        // presence is already `thinking` by now; with nobody listening it
        // reports `queued`. The browser sees the current answer on its next
        // finite state poll.
        return sendJson(res, 200, {
          status: 'queued',
          accepted: result.accepted.length,
          pending: result.pending,
          presence: presenceFor(key)
        });
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
        clearAgentActivity(key);
        return sendJson(res, 200, { status: 'sent', at: entry.at });
      }

      // Agents drive the chat indicator explicitly: `thinking` while they work,
      // `typing` right before a reply lands, `idle` to take the bubble down.
      if (action === 'typing') {
        const body = await readJsonBody(req);
        const state = typeof body.state === 'string' ? body.state : 'typing';
        if (!TYPING_STATES.has(state)) {
          return sendJson(res, 400, { error: `state must be one of: ${[...TYPING_STATES].join(', ')}` });
        }
        if (state === 'idle') clearAgentActivity(key);
        else if (state === 'typing') typingKeys.set(key, Date.now());
        else markThinking(key);
        return sendJson(res, 200, { status: 'ok', presence: presenceFor(key) });
      }
    }

    return sendJson(res, 404, { error: 'not found' });
  }

  function handleEvents(req, res, key) {
    const session = store.get(key);
    if (!session) return sendJson(res, 404, { error: 'unknown session' });
    // Older Canvas clients opened one permanent EventSource per tab. Six open
    // tabs exhausted Chromium's HTTP/1 connection pool for this origin, so
    // the next top-level navigation waited forever without receiving a byte.
    // HTTP 204 tells EventSource not to reconnect, releasing legacy tabs after
    // a server upgrade. Current clients use finite state polling below.
    res.writeHead(204, { 'cache-control': 'no-store', connection: 'close' });
    res.end();
  }

  function serveArtifact(res, key, assetPath, { pdfExport = false } = {}) {
    const session = store.get(key);
    if (!session) return sendHtml(res, 404, '<h1>Unknown session</h1>');

    if (!assetPath) {
      if (pdfExport && pdfSnapshot && pdfSnapshot.key === key) {
        return sendHtml(res, 200, pdfSnapshot.html, { csp: PDF_EXPORT_CSP });
      }
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
        return sendHtml(res, 200, html, { csp: pdfExport ? PDF_EXPORT_CSP : false });
      }
      const sdkTag = '<script src="/sdk.js"></script>';
      const injected = content.includes('</body>')
        ? content.replace('</body>', `${sdkTag}\n</body>`)
        : `${content}\n${sdkTag}`;
      return sendHtml(res, 200, injected, { csp: pdfExport ? PDF_EXPORT_CSP : false });
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
          return sendJson(res, 200, {
            ok: true,
            app: 'ecc-plan-canvas',
            version,
            protocolVersion: PLAN_CANVAS_PROTOCOL_VERSION,
            runtimeId: PLAN_CANVAS_RUNTIME_ID
          });
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
          return serveArtifact(res, artifactMatch[1], assetPath || null, {
            pdfExport: url.searchParams.get('pdf') === '1'
          });
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

  return { server, listen, close, presenceFor };
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_THINKING_STALE_MS,
  DEFAULT_TYPING_EXPIRY_MS,
  PLAN_CANVAS_PROTOCOL_VERSION,
  PLAN_CANVAS_RUNTIME_ID,
  createPlanCanvasServer,
  resolveIdleTimeoutMs,
  resolvePort
};
