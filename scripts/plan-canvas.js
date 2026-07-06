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
const path = require('path');
const { spawn } = require('child_process');

const {
  canonicalizeArtifactPath,
  createSessionStore,
  resolveStateDir,
  sessionKeyFor
} = require('./lib/plan-canvas/sessions');
const {
  DEFAULT_HOST,
  createPlanCanvasServer,
  resolveIdleTimeoutMs,
  resolvePort
} = require('./lib/plan-canvas/server');

const VERSION = require('../package.json').version;

function usage() {
  return [
    'Plan Canvas - review plans and HTML artifacts in the browser',
    '',
    'Usage:',
    '  node scripts/plan-canvas.js                      Show server status and sessions',
    '  node scripts/plan-canvas.js open <file>          Open (or resume) a review session',
    '  node scripts/plan-canvas.js await <file>         Block until the human sends feedback',
    '  node scripts/plan-canvas.js end <file>           End a session as the agent',
    '  node scripts/plan-canvas.js stop                 Shut down the canvas server',
    '  node scripts/plan-canvas.js server               Run the server in the foreground',
    '',
    'Options:',
    '  open:  --no-open      Do not launch a browser window',
    '         --reopen       Reopen a session the user ended from the browser',
    '  await: --reply <msg>  Show an agent reply in the canvas chat before waiting',
    '         --timeout-ms <n>  Return {status:"waiting"} after n ms (tests/debug only)',
    '  server: --port <n> --host <h>',
    '',
    'Environment: ECC_PLAN_CANVAS_PORT, ECC_PLAN_CANVAS_STATE_DIR, ECC_PLAN_CANVAS_IDLE_MS'
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

function request(port, method, requestPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: DEFAULT_HOST,
        port,
        method,
        path: requestPath,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
          : {}
      },
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

// Start (or reuse) the detached canvas server and return its port. A version
// mismatch after an ECC update restarts the server so browser and CLI never
// disagree about the protocol.
async function ensureServer({ stateDir, port }) {
  const health = await healthCheck(port);
  if (health && health.version === VERSION) return port;
  if (health) {
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
    if (await healthCheck(port)) return port;
  }
  throw new Error(`plan-canvas server did not become healthy on port ${port}; check ${path.join(stateDir, 'server.log')}`);
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
  return { server: `http://${DEFAULT_HOST}:${port}`, version: health.version, sessions: sessions.body.sessions };
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

function awaitRequest(port, file, timeoutMs) {
  const params = new URLSearchParams({ file });
  if (timeoutMs !== null) params.set('timeoutMs', String(timeoutMs));
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: DEFAULT_HOST, port, method: 'GET', path: `/api/await?${params}` },
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
  const result = await awaitRequest(port, path.resolve(file), timeoutMs);
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
    JSON.stringify({ pid: process.pid, port: bound.port, version: VERSION, startedAt: new Date().toISOString() }, null, 2)
  );
  // Sessions restored from disk resume their file watchers.
  for (const session of store.list()) {
    if (session.status !== 'ended') canvas.watchSession(store.get(session.key));
  }
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

module.exports = { main, ensureServer, healthCheck };
