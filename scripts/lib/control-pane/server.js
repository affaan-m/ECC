'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const { buildControlPaneAction } = require('./actions');
const { buildControlPaneSnapshot, resolveControlPaneConfig } = require('./state');
const { renderControlPaneHtml } = require('./ui');

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

// Extract the hostname portion of an HTTP Host header value, stripping any
// port. Returns null when the header is missing or malformed. Used to gate
// requests against a local-only allowlist so DNS-rebinding cannot pivot a
// browser tab into the loopback control-pane API.
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

function isAllowedOrigin(originHeader, allowedHostnames) {
  if (!originHeader || typeof originHeader !== 'string') return true;
  try {
    const url = new URL(originHeader);
    return allowedHostnames.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function usage() {
  return [
    'Usage:',
    '  node scripts/control-pane.js [--host 127.0.0.1] [--port 8765] [--db <ecc2.db>] [--state-db <state.db>] [--config <ecc2.toml>] [--query <text>]',
    '',
    'Options:',
    '  --state-db <path>  Read agent work items from an ECC state-store database',
    '  --read-only        Disable action execution endpoints',
    '  --no-open          Do not open a browser after the server starts',
    '  --help             Show this help',
  ].join('\n');
}

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function pathValueAfter(args, name) {
  const value = valueAfter(args, name);
  if (value === null) return null;
  if (!value || value.startsWith('-')) {
    throw new Error(`Invalid ${name} value: expected a path`);
  }
  return value;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const help = args.includes('--help') || args.includes('-h');
  const host = valueAfter(args, '--host') || '127.0.0.1';
  const portValue = valueAfter(args, '--port') || '8765';
  const port = Number.parseInt(portValue, 10);
  if (!Number.isFinite(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid --port value: ${portValue}`);
  }

  return {
    help,
    host,
    port,
    dbPath: valueAfter(args, '--db'),
    stateDbPath: pathValueAfter(args, '--state-db'),
    configPath: valueAfter(args, '--config'),
    query: valueAfter(args, '--query') || '',
    openBrowser: !args.includes('--no-open'),
    allowActions: !args.includes('--read-only'),
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(`${body}\n`);
}

function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function boundedOutput(value, limit = 20000) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars]`;
}

function runAction(action, options = {}) {
  const timeoutMs = options.timeoutMs || 120000;
  return new Promise(resolve => {
    const startedAt = new Date().toISOString();
    const child = spawn(action.command, action.args, {
      cwd: action.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        child.kill('SIGTERM');
      }
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', error => {
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: false,
        action: action.id,
        startedAt,
        finishedAt: new Date().toISOString(),
        code: null,
        error: error.message,
        stdout: boundedOutput(stdout),
        stderr: boundedOutput(stderr),
      });
    });
    child.on('close', (code, signal) => {
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        action: action.id,
        startedAt,
        finishedAt: new Date().toISOString(),
        code,
        signal,
        stdout: boundedOutput(stdout),
        stderr: boundedOutput(stderr),
      });
    });
  });
}

function createControlPaneServer(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..', '..', '..'));
  const host = options.host || '127.0.0.1';
  const port = options.port === null || options.port === undefined ? 8765 : options.port;
  const allowActions = options.allowActions !== false;
  const resolvedConfig = resolveControlPaneConfig({
    cwd: options.cwd || repoRoot,
    configPath: options.configPath,
    dbPath: options.dbPath,
    stateDbPath: options.stateDbPath,
    env: options.env || process.env,
  });
  const baseQuery = options.query || '';
  const allowedHostnames = buildAllowedHostnames(host);

  const server = http.createServer(async (req, res) => {
    try {
      if (!isAllowedHostHeader(req.headers.host, allowedHostnames)) {
        sendJson(res, 421, { ok: false, error: 'Misdirected request' });
        return;
      }
      if (!isAllowedOrigin(req.headers.origin, allowedHostnames)) {
        sendJson(res, 403, { ok: false, error: 'Forbidden origin' });
        return;
      }

      const requestUrl = new URL(req.url, `http://${host}:${port || 0}`);

      if (req.method === 'GET' && requestUrl.pathname === '/') {
        sendText(res, 200, renderControlPaneHtml(), 'text/html; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/assets/ecc-icon.svg') {
        const iconPath = path.join(repoRoot, 'assets', 'ecc-icon.svg');
        if (!fs.existsSync(iconPath)) {
          sendText(res, 404, 'not found');
          return;
        }
        sendText(res, 200, fs.readFileSync(iconPath, 'utf8'), 'image/svg+xml; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          repoRoot,
          dbPath: resolvedConfig.dbPath,
          stateDbPath: resolvedConfig.stateDbPath,
          allowActions,
        });
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/snapshot') {
        const snapshot = await buildControlPaneSnapshot({
          repoRoot,
          dbPath: resolvedConfig.dbPath,
          stateDbPath: resolvedConfig.stateDbPath,
          config: resolvedConfig,
          query: requestUrl.searchParams.get('query') || baseQuery,
          limit: requestUrl.searchParams.get('limit') || 12,
          allowActions,
        });
        sendJson(res, 200, snapshot);
        return;
      }

      const actionMatch = requestUrl.pathname.match(/^\/api\/actions\/([^/]+)$/);
      if (req.method === 'POST' && actionMatch) {
        if (!allowActions) {
          sendJson(res, 403, {
            ok: false,
            error: 'Control-pane action execution is disabled by --read-only.',
          });
          return;
        }

        const body = await readRequestJson(req);
        const action = buildControlPaneAction(decodeURIComponent(actionMatch[1]), {
          repoRoot,
          query: body.query || baseQuery,
          limit: body.limit || 25,
        });

        if (!action.executable) {
          sendJson(res, 400, {
            ok: false,
            action: action.id,
            error: 'This action is copy-only and cannot be executed from the browser.',
            commandLine: action.commandLine,
          });
          return;
        }

        const result = await runAction(action);
        sendJson(res, result.ok ? 200 : 500, {
          ...result,
          commandLine: action.commandLine,
        });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
      });
    }
  });

  return {
    get url() {
      const address = server.address();
      const actualPort = address && typeof address === 'object' ? address.port : port;
      return `http://${host}:${actualPort}`;
    },
    server,
    config: resolvedConfig,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve(this);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close(error => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

module.exports = {
  createControlPaneServer,
  parseArgs,
  runAction,
  isAllowedHostHeader,
  isAllowedOrigin,
  buildAllowedHostnames,
  usage,
};
