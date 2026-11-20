'use strict';

// The operator binds one canonical canvas artifact to one native session.
// Browser data never chooses a project, executable, transport host or receipt.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { sessionKeyFor } = require('./plan-canvas/session-key');
const { findPotentialSecrets, hasUnsafeControlCharacters } = require('./memory-vault-format');
const MAX_BYTES = 64 * 1024;
const BUDGET_MS = 1000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const RECEIPT_KEYS = ['schema', 'workspace', 'sessionId', 'artifact', 'stateDir', 'key', 'canvasCreatedAt', 'server', 'delivered'];

function sessionId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error('Invalid Copilot session ID.');
  }
  return value;
}

function configRoot(env) {
  const configured = env.COPILOT_HOME;
  if (configured !== undefined && !path.isAbsolute(configured)) {
    throw new Error('An explicit Copilot home must be absolute.');
  }
  return configured || path.join(os.homedir(), '.copilot');
}

function readBounded(file, maxBytes) {
  const current = fs.lstatSync(file);
  if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.size > maxBytes) {
    throw new Error('Unsafe or oversized Canvas state file.');
  }
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
  const descriptor = fs.openSync(file, flags);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== current.dev || opened.ino !== current.ino) {
      throw new Error('Canvas state file changed while opening.');
    }
    const bytes = Buffer.alloc(maxBytes + 1);
    let used = 0;
    while (used < bytes.length) {
      const count = fs.readSync(descriptor, bytes, used, bytes.length - used, null);
      if (count === 0) break;
      used += count;
    }
    if (used > maxBytes) throw new Error('Canvas state file exceeded its read limit.');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used));
  } finally {
    fs.closeSync(descriptor);
  }
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid canvas object.');
  return value;
}
function iso(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}
function artifactPath(workspace, file) {
  if (typeof file !== 'string' || /[\r\n\0]/.test(file)) throw new Error('Invalid canvas artifact.');
  const target = path.resolve(workspace, file);
  const canonical = fs.realpathSync(target);
  const stat = fs.lstatSync(target);
  if (!inside(workspace, canonical) || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe canvas artifact.');
  return canonical;
}
function privateDirectory(workspace, env, create) {
  const base = configRoot(env);
  if (!fs.existsSync(base)) {
    if (!create) return null;
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  }
  let current = fs.realpathSync(base);
  for (const segment of ['ecc', 'canvas', hash(workspace)]) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe canvas receipt directory.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) return null;
      try { fs.mkdirSync(current, { mode: 0o700 }); }
      catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe canvas receipt directory.');
    }
  }
  return current;
}
function bindingPath(workspace, id, env = process.env, create = false) {
  const directory = privateDirectory(fs.realpathSync(workspace), env, create);
  return directory ? path.join(directory, `${hash(sessionId(id))}.json`) : null;
}
function serverInfo(stateDir) {
  const value = object(JSON.parse(readBounded(path.join(stateDir, 'server.json'), MAX_BYTES)));
  if (Object.keys(value).some(key => !['pid', 'port', 'version', 'startedAt'].includes(key))
    || !Number.isSafeInteger(value.pid) || value.pid < 1 || !Number.isSafeInteger(value.port)
    || value.port < 1 || value.port > 65535 || typeof value.version !== 'string'
    || !/^[A-Za-z0-9._-]{1,64}$/.test(value.version) || !iso(value.startedAt)) throw new Error('Invalid canvas server identity.');
  return { pid: value.pid, port: value.port, version: value.version, startedAt: value.startedAt };
}
function canvasSession(receipt) {
  const state = object(JSON.parse(readBounded(path.join(receipt.stateDir, 'sessions.json'), 4 * 1024 * 1024)));
  const selected = object(object(state.sessions)[receipt.key]);
  if (selected.key !== receipt.key || selected.file !== receipt.artifact || (selected.mode ?? 'plan') !== 'plan' || !iso(selected.createdAt)
    || (receipt.canvasCreatedAt && selected.createdAt !== receipt.canvasCreatedAt)) throw new Error('Canvas session identity is unavailable.');
  return selected;
}
function validateReceipt(value, workspace, id) {
  object(value);
  if (value.schema !== 'ecc.copilot.canvas-binding.v1' || Object.keys(value).some(key => !RECEIPT_KEYS.includes(key))
    || value.workspace !== workspace || value.sessionId !== id || !iso(value.canvasCreatedAt)
    || typeof value.stateDir !== 'string' || !path.isAbsolute(value.stateDir)
    || fs.realpathSync(value.stateDir) !== value.stateDir || value.key !== sessionKeyFor(artifactPath(workspace, value.artifact))
    || !Array.isArray(value.delivered) || value.delivered.length > 512
    || new Set(value.delivered).size !== value.delivered.length
    || value.delivered.some(item => typeof item !== 'string' || !/^fb-[0-9]{1,16}$/.test(item))) throw new Error('Invalid canvas receipt.');
  if (!value.server || JSON.stringify(value.server) !== JSON.stringify(serverInfo(value.stateDir))) throw new Error('Canvas server identity changed; explicitly bind again.');
  return { receipt: value, session: canvasSession(value) };
}
function readReceipt(file, workspace, id) {
  if (!file) return null;
  let raw;
  try { raw = readBounded(file, MAX_BYTES); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return validateReceipt(JSON.parse(raw), workspace, id);
}
function atomicWrite(file, receipt) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(receipt)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function bind(workspace, options, env = process.env) {
  const canonical = fs.realpathSync(workspace);
  const id = sessionId(options.sessionId);
  const artifact = artifactPath(canonical, options.file);
  if (typeof options.stateDir !== 'string' || !path.isAbsolute(options.stateDir)) throw new Error('Explicit absolute canvas state directory required.');
  const stateDir = fs.realpathSync(options.stateDir);
  const draft = { schema: 'ecc.copilot.canvas-binding.v1', workspace: canonical, sessionId: id,
    artifact, stateDir, key: sessionKeyFor(artifact), server: serverInfo(stateDir), delivered: [] };
  const receipt = { ...draft, canvasCreatedAt: canvasSession(draft).createdAt };
  const file = bindingPath(canonical, id, env, true); const lock = `${file}.lock`;
  const ownershipLock = path.join(path.dirname(file), 'bindings.lock');
  fs.mkdirSync(ownershipLock, { mode: 0o700 });
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
    try {
      const previous = readReceipt(file, canonical, id)?.receipt;
      if (previous) {
        if (previous.key !== receipt.key || previous.stateDir !== receipt.stateDir) throw new Error('Explicit unbind required before replacing a receipt.');
        return previous;
      }
      const existing = fs.readdirSync(path.dirname(file)).filter(name => name.endsWith('.json'));
      if (existing.length > 1000) throw new Error('Canvas receipt scan quota exceeded.');
      for (const name of existing) {
        const other = JSON.parse(readBounded(path.join(path.dirname(file), name), MAX_BYTES));
        if (!/^[a-f0-9]{64}\.json$/.test(name) || name !== `${hash(sessionId(other.sessionId))}.json`) throw new Error('Invalid canvas receipt identity.');
        validateReceipt(other, canonical, other.sessionId);
        if (other.key === receipt.key && other.stateDir === receipt.stateDir) throw new Error('Artifact is bound to another native session; explicitly unbind first.');
      }
      atomicWrite(file, receipt); return receipt;
    } finally { fs.rmdirSync(lock); }
  } finally { fs.rmdirSync(ownershipLock); }
}
function unbind(workspace, id, env = process.env) {
  const file = bindingPath(workspace, id, env);
  if (!file) return { removed: false };
  const lock = `${file}.lock`; const ownershipLock = path.join(path.dirname(file), 'bindings.lock');
  fs.mkdirSync(ownershipLock, { mode: 0o700 });
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
    try {
      // Inspect the file itself, but allow removal of stale-server receipts.
      try { readBounded(file, MAX_BYTES); fs.unlinkSync(file); return { removed: true }; }
      catch (error) { if (error.code === 'ENOENT') return { removed: false }; throw error; }
    } finally { fs.rmdirSync(lock); }
  } finally { fs.rmdirSync(ownershipLock); }
}
function poll(port, key, createdAt) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy();
      resolve(value);
    };
    const query = new URLSearchParams({ key, createdAt });
    const request = http.request({ host: '127.0.0.1', port, method: 'POST',
      path: `/api/feedback-batch?${query}`, agent: false }, response => {
      if (response.statusCode !== 200) { finish(null); return; }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) finish(null);
        else chunks.push(chunk);
      });
      response.on('end', () => {
        try { finish(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
        catch { finish(null); }
      });
      response.on('error', () => finish(null));
      response.on('aborted', () => finish(null));
    });
    request.on('error', () => finish(null));
    const timer = setTimeout(() => finish(null), BUDGET_MS);
    request.end();
  });
}
function reviewText(value) {
  if (typeof value !== 'string' || value.length > 4000 || hasUnsafeControlCharacters(value, true)
    || findPotentialSecrets(value).length || /\b(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+/i.test(value)) return '[unsafe or sensitive review text omitted]';
  return value.slice(0, 1000);
}
function feedbackItems(result, delivered) {
  const seen = new Set(delivered);
  return result.items.flatMap(item => {
    if (!item || typeof item.id !== 'string' || !/^fb-[0-9]{1,16}$/.test(item.id)
      || !['chat', 'annotation', 'verdict'].includes(item.kind) || seen.has(item.id)) return [];
    if (item.kind === 'verdict' && !['approve', 'request-changes'].includes(item.verdict)) return [];
    seen.add(item.id);
    return [{ id: item.id, kind: item.kind, ...(item.kind === 'verdict' ? { verdict: item.verdict } : {}), text: reviewText(item.text) }];
  });
}
async function takeBoundFeedback(workspace, id, env = process.env) {
  const canonical = fs.realpathSync(workspace);
  const file = bindingPath(canonical, id, env);
  if (!readReceipt(file, canonical, id)) return { status: 'unbound' };
  const lock = `${file}.lock`;
  fs.mkdirSync(lock, { mode: 0o700 });
  try {
    const current = readReceipt(file, canonical, id)?.receipt;
    if (!current) return { status: 'unbound' };
    const result = await poll(current.server.port, current.key, current.canvasCreatedAt);
    if (['waiting', 'missing', 'ended'].includes(result?.status)) return { status: result.status };
    if (result?.status !== 'feedback' || !Array.isArray(result.items) || result.items.length > 20) {
      return { status: 'unavailable' };
    }
    const items = feedbackItems(result, current.delivered);
    if (!items.length) return { status: 'no-new-feedback' };
    atomicWrite(file, { ...current, delivered: [...current.delivered, ...items.map(item => item.id)].slice(-512) });
    return { status: 'feedback', trust: 'untrusted-review-data', items, sessionEnded: result.sessionEnded === true };
  } finally { fs.rmdirSync(lock); }
}
module.exports = { bind, unbind, takeBoundFeedback };
