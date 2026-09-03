#!/usr/bin/env node
'use strict';

/**
 * Plan Canvas CLI — open plan artifacts in a browser review canvas and block
 * on human feedback.
 *
 *   node scripts/plan-canvas.js open .claude/plans/feature.plan.md
 *   node scripts/plan-canvas.js await .claude/plans/feature.plan.md
 *   node scripts/plan-canvas.js await <file> --reply "Updated section 3."
 *   node scripts/plan-canvas.js end <file>
 *   node scripts/plan-canvas.js stop
 *
 * Agents: `open` returns immediately (the server is a detached process);
 * `await` long-polls until the human sends feedback, a verdict, or ends the
 * session, then prints a JSON payload to stdout. Progress notes go to stderr
 * so stdout stays parseable.
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const {
  canonicalizeArtifactPath,
  createSessionStore,
  resolveStateDir,
  sessionKeyFor
} = require('./lib/plan-canvas/sessions');
const {
  DEFAULT_HOST,
  PLAN_CANVAS_PROTOCOL_VERSION,
  PLAN_CANVAS_RUNTIME_ID,
  createPlanCanvasServer,
  resolveIdleTimeoutMs,
  resolvePort
} = require('./lib/plan-canvas/server');

const VERSION = require('../package.json').version;

const SAFE_REQUEST_PATHS = new Set([
  '/',
  '/health',
  '/shutdown',
  '/api/await',
  '/api/sessions',
  '/api/end'
]);
const SESSION_REPLY_PATH = /^\/api\/session\/[a-f0-9]{12}\/(reply|typing)$/;

function usage() {
  return [
    'Plan Canvas - review plans and HTML artifacts in the browser',
    '',
    'Usage:',
    '  node scripts/plan-canvas.js                      Show server status and sessions',
    '  node scripts/plan-canvas.js open <file>          Open (or resume) a review session',
    '  node scripts/plan-canvas.js await <file>         Block until the human sends feedback',
    '  node scripts/plan-canvas.js pending              Show feedback queued for no listener',
    '  node scripts/plan-canvas.js typing <file>        Show a thinking/typing indicator in chat',
    '  node scripts/plan-canvas.js end <file>           End a session as the agent',
    '  node scripts/plan-canvas.js stop                 Shut down the canvas server',
    '  node scripts/plan-canvas.js server               Run the server in the foreground',
    '',
    'Options:',
    '  open:  --no-open      Do not launch a browser window',
    '         --reopen       Reopen a session the user ended from the browser',
    '  await: --reply <msg>  Show an agent reply in the canvas chat before waiting',
    '         --timeout-ms <n>  Return {status:"waiting"} after n ms (tests/debug only)',
    '  typing: --state <thinking|typing|idle>  Defaults to typing',
    '  server: --port <n> --host <h>',
    '',
    'Environment: ECC_PLAN_CANVAS_PORT, ECC_PLAN_CANVAS_STATE_DIR, ECC_PLAN_CANVAS_IDLE_MS,',
    '             ECC_PLAN_CANVAS_CHROME_PATH'
  ].join('\n');
}

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

function serverInfoPath(stateDir) {
  return path.join(stateDir, 'server.json');
}

function readServerInfo(stateDir) {
  try {
    return JSON.parse(fs.readFileSync(serverInfoPath(stateDir), 'utf8'));
  } catch {
    return null;
  }
}

function validatePort(port) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`invalid plan-canvas server port: ${port}`);
  }
  return value;
}

function validateRequestPath(requestPath) {
  if (typeof requestPath !== 'string' || !requestPath.startsWith('/')) {
    throw new Error('plan-canvas request path must be root-relative');
  }
  const url = new URL(requestPath, `http://${DEFAULT_HOST}`);
  if (url.hostname !== DEFAULT_HOST) {
    throw new Error('plan-canvas request path must stay on the loopback server');
  }
  if (!SAFE_REQUEST_PATHS.has(url.pathname) && !SESSION_REPLY_PATH.test(url.pathname)) {
    throw new Error(`unsupported plan-canvas request path: ${url.pathname}`);
  }
  return `${url.pathname}${url.search}`;
}

function requestOptions(port, method, requestPath, headers) {
  return {
    host: DEFAULT_HOST,
    port: validatePort(port),
    method,
    path: validateRequestPath(requestPath),
    agent: false,
    headers
  };
}

function request(port, method, requestPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request(
      requestOptions(
        port,
        method,
        requestPath,
        payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
          : {}
      ),
      res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(data.trim() || '{}') });
          } catch {
            resolve({ statusCode: res.statusCode, body: {} });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function healthCheck(port) {
  try {
    const res = await request(port, 'GET', '/health');
    return res.body && res.body.app === 'ecc-plan-canvas' ? res.body : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readProcessIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const commandEnd = stat.lastIndexOf(')');
      if (commandEnd === -1) return null;
      const fieldsAfterCommand = stat.slice(commandEnd + 1).trim().split(/\s+/);
      const startTicks = fieldsAfterCommand[19];
      return startTicks ? `linux:${startTicks}` : null;
    }
    if (process.platform === 'win32') {
      const command = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`;
      const startTicks = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, windowsHide: true }
      ).trim();
      return startTicks ? `win32:${startTicks}` : null;
    }
    const startedAt = execFileSync(
      'ps',
      ['-p', String(pid), '-o', 'lstart='],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 }
    ).trim();
    return startedAt ? `${process.platform}:${startedAt}` : null;
  } catch {
    return null;
  }
}

function readServerStartTicket(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const stat = fs.fstatSync(fd);
    try {
      const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
      return { ...value, mtimeMs: stat.mtimeMs, malformed: false };
    } catch {
      return { mtimeMs: stat.mtimeMs, malformed: true };
    }
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best-effort ticket inspection */ }
    }
  }
}

function listServerStartTickets(lockDir, port, ownToken, malformedStaleAfterMs = 60 * 1000) {
  const prefix = `ecc-plan-canvas-${validatePort(port)}-`;
  const entries = [];
  const identities = new Map();
  for (const name of fs.readdirSync(lockDir)) {
    if (!name.startsWith(prefix) || (!name.endsWith('.choosing') && !name.endsWith('.ticket'))) continue;
    const file = path.join(lockDir, name);
    let value = null;
    try {
      value = readServerStartTicket(file);
    } catch {
      // The owner may already have removed its unique ticket.
      continue;
    }
    if (value.malformed) {
      if (Date.now() - value.mtimeMs > malformedStaleAfterMs) {
        try { fs.rmSync(file, { force: true }); } catch { /* already removed */ }
      }
      continue;
    }
    let stale = false;
    if (value.token !== ownToken) {
      if (!processIsAlive(value.pid)) {
        stale = true;
      } else if (typeof value.processIdentity === 'string') {
        if (!identities.has(value.pid)) identities.set(value.pid, readProcessIdentity(value.pid));
        const currentIdentity = identities.get(value.pid);
        stale = currentIdentity !== null && currentIdentity !== value.processIdentity;
      }
    }
    if (stale) {
      // Process start identity distinguishes an exited owner from an unrelated
      // process that later reused its PID. A live owner remains authoritative
      // even if its event loop is paused for an arbitrary amount of time.
      try { fs.rmSync(file, { force: true }); } catch { /* already removed */ }
      continue;
    }
    entries.push({ ...value, file, choosing: name.endsWith('.choosing') });
  }
  return entries;
}

async function withServerStartLock(port, task, {
  timeoutMs = 15 * 1000,
  lockDir = path.join(os.homedir(), '.claude', 'plan-canvas', 'locks')
} = {}) {
  const lockPort = validatePort(port);
  const processIdentity = readProcessIdentity(process.pid);
  if (!processIdentity) throw new Error('could not determine Plan Canvas startup lock process identity');
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const prefix = `ecc-plan-canvas-${lockPort}-${token}`;
  const choosingFile = path.join(lockDir, `${prefix}.choosing`);
  const ticketFile = path.join(lockDir, `${prefix}.ticket`);
  const startedAt = Date.now();
  fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    choosingFile,
    JSON.stringify({ pid: process.pid, processIdentity, token }),
    { flag: 'wx', mode: 0o600 }
  );

  try {
    const existing = listServerStartTickets(lockDir, lockPort, token)
      .filter(entry => !entry.choosing && Number.isInteger(entry.number));
    const number = existing.reduce((maximum, entry) => Math.max(maximum, entry.number), 0) + 1;
    fs.writeFileSync(
      ticketFile,
      JSON.stringify({ pid: process.pid, processIdentity, token, number }),
      { flag: 'wx', mode: 0o600 }
    );
    fs.rmSync(choosingFile, { force: true });

    while (true) {
      const entries = listServerStartTickets(lockDir, lockPort, token);
      const anotherOwnerIsChoosing = entries.some(entry => entry.choosing && entry.token !== token);
      const tickets = entries
        .filter(entry => !entry.choosing && Number.isInteger(entry.number))
        .sort((left, right) => left.number - right.number || left.token.localeCompare(right.token));
      if (!anotherOwnerIsChoosing && tickets[0] && tickets[0].token === token) break;
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`timed out waiting for Plan Canvas startup lock on port ${port}`);
      }
      await sleep(50);
    }
    return await task();
  } finally {
    fs.rmSync(choosingFile, { force: true });
    fs.rmSync(ticketFile, { force: true });
  }
}

function serverIsCompatible(health) {
  return Boolean(
    health &&
    health.version === VERSION &&
    health.protocolVersion === PLAN_CANVAS_PROTOCOL_VERSION &&
    health.runtimeId === PLAN_CANVAS_RUNTIME_ID
  );
}

// Start (or reuse) the detached canvas server and return its port. Worktrees
// can share a package version while carrying different Canvas code, so the
// health handshake binds reuse to the exact server runtime as well.
async function ensureServer({ stateDir, port }) {
  const health = await healthCheck(port);
  if (serverIsCompatible(health)) return port;
  return withServerStartLock(port, async () => {
    const lockedHealth = await healthCheck(port);
    if (serverIsCompatible(lockedHealth)) return port;
    if (lockedHealth) {
      await request(port, 'POST', '/shutdown').catch(() => {});
      for (let i = 0; i < 20 && (await healthCheck(port)); i++) await sleep(100);
    }
    fs.mkdirSync(stateDir, { recursive: true });
    const logFd = fs.openSync(path.join(stateDir, 'server.log'), 'a');
    const child = spawn(process.execPath, [__filename, 'server', '--port', String(port)], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, ECC_PLAN_CANVAS_STATE_DIR: stateDir }
    });
    child.unref();
    fs.closeSync(logFd);
    for (let i = 0; i < 50; i++) {
      await sleep(100);
      if (serverIsCompatible(await healthCheck(port))) return port;
    }
    throw new Error(`plan-canvas server did not become compatible on port ${port}; check ${path.join(stateDir, 'server.log')}`);
  });
}

function openBrowser(url) {
  const platform = process.platform;
  const [cmd, args] =
    platform === 'darwin' ? ['open', [url]]
      : platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

function output(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function cmdStatus({ stateDir, port }) {
  const health = await healthCheck(port);
  if (!health) {
    return { server: 'not running', hint: 'open an artifact to start one', stateDir };
  }
  const sessions = await request(port, 'GET', '/api/sessions');
  return {
    server: `http://${DEFAULT_HOST}:${port}`,
    version: health.version,
    protocolVersion: health.protocolVersion,
    runtimeId: health.runtimeId,
    sessions: sessions.body.sessions
  };
}

async function cmdOpen(file, args, { stateDir, port }) {
  if (!file) throw new Error('open requires a file path');
  if (!fs.existsSync(path.resolve(file))) throw new Error(`artifact not found: ${file}`);
  await ensureServer({ stateDir, port });
  const res = await request(port, 'POST', '/api/sessions', {
    file: path.resolve(file),
    reopen: args.includes('--reopen')
  });
  if (res.statusCode === 409) return res.body;
  if (res.statusCode !== 200) throw new Error(res.body.error || `open failed (HTTP ${res.statusCode})`);
  const url = `http://${DEFAULT_HOST}:${port}${res.body.url}`;
  const launched = args.includes('--no-open') ? false : openBrowser(url);
  return {
    status: 'open',
    url,
    browser: launched ? 'opened' : 'not opened',
    next_step:
      'Run `ecc-plan-canvas await <file>` and leave it running; it returns when the human sends feedback, a verdict, or ends the session.'
  };
}

function awaitRequest(port, key, timeoutMs) {
  if (!/^[a-f0-9]{12}$/.test(key)) throw new Error('invalid plan-canvas session key');
  const params = new URLSearchParams({ key });
  if (timeoutMs !== null) params.set('timeoutMs', String(timeoutMs));
  return new Promise((resolve, reject) => {
    const req = http.request(
      requestOptions(port, 'GET', `/api/await?${params}`, {}),
      res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data.trim()));
          } catch {
            reject(new Error('await response was not JSON (server restarted?) - re-run await; feedback is never lost'));
          }
        });
      }
    );
    req.setTimeout(0);
    req.on('error', reject);
    req.end();
  });
}

async function cmdAwait(file, args, { stateDir, port }) {
  if (!file) throw new Error('await requires a file path');
  if (!(await healthCheck(port))) {
    return { status: 'no-server', hint: 'no canvas server is running; use `open` first', stateDir };
  }
  const reply = valueAfter(args, '--reply');
  if (reply) {
    const key = sessionKeyFor(canonicalizeArtifactPath(file));
    await request(port, 'POST', `/api/session/${key}/reply`, { text: reply });
  }
  const timeoutRaw = valueAfter(args, '--timeout-ms');
  const timeoutMs = timeoutRaw === null ? null : Number.parseInt(timeoutRaw, 10) || 0;
  process.stderr.write('[plan-canvas] waiting for human feedback... leave this running (re-run if interrupted; queued feedback is never lost)\n');
  const result = await awaitRequest(port, sessionKeyFor(canonicalizeArtifactPath(file)), timeoutMs);
  if (result.status === 'feedback') {
    result.next_step = result.sessionEnded
      ? 'The user sent this feedback and ended the session. Address it and report in chat; do not reopen the canvas uninvited.'
      : 'Address the feedback, then run `ecc-plan-canvas await <file> --reply "<what you changed>"` to answer in the canvas and keep listening.';
  } else if (result.status === 'ended') {
    result.next_step =
      result.endedBy === 'user'
        ? 'The user ended this review. Stop polling and deliver any remaining updates in chat; do not reopen uninvited.'
        : 'Session ended. Stop polling.';
  }
  return result;
}

// Show the human an activity indicator in the canvas chat. Cheap and
// fire-and-forget: a failed signal must never derail the actual work.
async function cmdTyping(file, args, { port }) {
  if (!file) throw new Error('typing requires a file path');
  const state = valueAfter(args, '--state') || 'typing';
  if (!(await healthCheck(port))) return { status: 'no-server' };
  const key = sessionKeyFor(canonicalizeArtifactPath(file));
  const res = await request(port, 'POST', `/api/session/${key}/typing`, { state });
  if (res.statusCode !== 200) throw new Error(res.body.error || `typing failed (HTTP ${res.statusCode})`);
  return { status: 'ok', state, presence: res.body.presence };
}

// Report feedback the human sent that no agent has picked up yet. Reads state
// directly so it answers even when the server has idled out.
function cmdPending({ stateDir }) {
  const store = createSessionStore({ stateDir });
  const waiting = store
    .list()
    .filter(session => session.status !== 'ended' && session.pending > 0)
    .map(session => ({ file: session.file, pending: session.pending, updatedAt: session.updatedAt }));
  return {
    status: waiting.length ? 'pending' : 'clear',
    sessions: waiting,
    next_step: waiting.length
      ? 'Run `ecc-plan-canvas await <file>` for each file above to receive the messages.'
      : 'No canvas feedback is waiting.'
  };
}

async function cmdEnd(file, { port }) {
  if (!file) throw new Error('end requires a file path');
  if (!(await healthCheck(port))) return { status: 'no-server' };
  const res = await request(port, 'POST', '/api/end', { file: path.resolve(file) });
  return res.body;
}

async function cmdStop({ stateDir, port }) {
  if (!(await healthCheck(port))) return { status: 'not running' };
  await request(port, 'POST', '/shutdown').catch(() => {});
  fs.rmSync(serverInfoPath(stateDir), { force: true });
  return { status: 'stopping' };
}

async function cmdServer(args, { stateDir, port }) {
  const portArg = valueAfter(args, '--port');
  const hostArg = valueAfter(args, '--host');
  const listenPort = portArg !== null ? Number.parseInt(portArg, 10) : port;
  const store = createSessionStore({ stateDir });
  let shuttingDown = false;
  const shutdown = async code => {
    if (shuttingDown) return;
    shuttingDown = true;
    fs.rmSync(serverInfoPath(stateDir), { force: true });
    await canvas.close().catch(() => {});
    process.exit(code);
  };
  const canvas = createPlanCanvasServer({
    store,
    host: hostArg || DEFAULT_HOST,
    version: VERSION,
    idleTimeoutMs: resolveIdleTimeoutMs(),
    onIdleShutdown: () => shutdown(0),
    log: line => process.stderr.write(`${line}\n`)
  });
  const bound = await canvas.listen(listenPort);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    serverInfoPath(stateDir),
    JSON.stringify({
      pid: process.pid,
      port: bound.port,
      version: VERSION,
      protocolVersion: PLAN_CANVAS_PROTOCOL_VERSION,
      runtimeId: PLAN_CANVAS_RUNTIME_ID,
      startedAt: new Date().toISOString()
    }, null, 2)
  );
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.stderr.write(`[plan-canvas] serving on http://${bound.host}:${bound.port}\n`);
  return new Promise(() => {}); // run until a signal or idle shutdown
}

async function main(argv = process.argv.slice(2)) {
  const args = argv.slice();
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const command = args[0] && !args[0].startsWith('--') ? args.shift() : null;
  const stateDir = resolveStateDir();
  // A running server may sit on a non-default port; trust its recorded info.
  const recorded = readServerInfo(stateDir);
  const context = { stateDir, port: (recorded && recorded.port) || resolvePort() };
  try {
    if (command === null) output(await cmdStatus(context));
    else if (command === 'open') output(await cmdOpen(args[0], args, context));
    else if (command === 'await') output(await cmdAwait(args[0], args, context));
    else if (command === 'pending') output(cmdPending(context));
    else if (command === 'typing') output(await cmdTyping(args[0], args, context));
    else if (command === 'end') output(await cmdEnd(args[0], context));
    else if (command === 'stop') output(await cmdStop(context));
    else if (command === 'server') await cmdServer(args, context);
    else {
      process.stderr.write(`Unknown command: ${command}\n\n${usage()}\n`);
      return 1;
    }
    return 0;
  } catch (error) {
    output({ error: error.message });
    return 1;
  }
}

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  });
}

module.exports = { main, ensureServer, healthCheck, withServerStartLock };
