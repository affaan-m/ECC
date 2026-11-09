'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { parseEventEnvelope } = require('./copilot-event-envelope');
const { configRoot, readBounded, sessionId } = require('./copilot-sessions');
const { findProjectRoot, detectFormatter, clearCaches } = require('./resolve-formatter');
const { run: designCheck } = require('../hooks/design-quality-check');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const MAX_STATE = 256 * 1024;
const MAX_FILES = 1024;
const MAX_CALLS = 512;
const EXTENSIONS = /\.(?:[cm]?[jt]sx?|astro|css|html|scss|svelte|vue)$/i;

function lockOwner(lock) {
  const stat = fs.lstatSync(lock);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe quality lock.');
  const owner = JSON.parse(readBounded(path.join(lock, 'owner.json'), 1024));
  if (Object.keys(owner).some(key => !['schema', 'pid', 'token'].includes(key))
    || owner.schema !== 'ecc.copilot.quality-lock.v1' || !Number.isSafeInteger(owner.pid) || owner.pid < 1
    || typeof owner.token !== 'string' || !/^[a-f0-9-]{36}$/.test(owner.token)) throw new Error('Unknown quality lock owner.');
  return owner;
}

function deadOwner(lock) {
  try {
    const owner = lockOwner(lock);
    try { process.kill(owner.pid, 0); } catch (error) { return error.code === 'ESRCH'; }
  } catch { /* Legacy, incomplete, linked and unknown-owner locks are never stolen. */ }
  return false;
}

function acquireLock(lock) {
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST' || !deadOwner(lock)) throw error;
    // Serialize recovery outside the original lock so inspecting a live owner
    // can never interfere with that owner's normal release.
    const recovery = `${lock}.recovery`;
    fs.mkdirSync(recovery, { mode: 0o700 });
    try {
      if (!deadOwner(lock) || fs.readdirSync(lock).some(name => name !== 'owner.json')) throw error;
      fs.unlinkSync(path.join(lock, 'owner.json'));
      fs.rmdirSync(lock);
      fs.mkdirSync(lock, { mode: 0o700 });
    } finally { fs.rmdirSync(recovery); }
  }
  const token = crypto.randomUUID();
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({
    schema: 'ecc.copilot.quality-lock.v1', pid: process.pid, token,
  }), { flag: 'wx', mode: 0o600 });
  return () => {
    if (lockOwner(lock).token !== token) throw new Error('Quality lock ownership changed.');
    fs.unlinkSync(path.join(lock, 'owner.json'));
    fs.rmdirSync(lock);
  };
}

function mode(env) {
  const value = env.ECC_COPILOT_QUALITY_MODE || 'check';
  if (!['off', 'check', 'fix'].includes(value)) throw new Error('Invalid Copilot quality mode.');
  return value;
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function identity(payload) {
  if (typeof payload?.cwd !== 'string' || !path.isAbsolute(payload.cwd)) throw new Error('Quality workspace must be absolute.');
  const id = sessionId(payload.sessionId ?? payload.session_id);
  return { workspace: fs.realpathSync(payload.cwd), id };
}

function storeDirectory(input, env, create) {
  const base = configRoot(env);
  if (!fs.existsSync(base)) {
    if (!create) return null;
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  }
  let current = fs.realpathSync(base);
  for (const segment of ['ecc', 'quality', hash(input.workspace), hash(input.id)]) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe quality state directory.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) return null;
      try { fs.mkdirSync(current, { mode: 0o700 }); }
      catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe quality state directory.');
    }
  }
  return current;
}

function readState(dir, input) {
  try {
    const value = JSON.parse(readBounded(path.join(dir, 'state.json'), MAX_STATE));
    if (Object.keys(value).some(key => !['schema', 'workspace', 'sessionId', 'files', 'calls'].includes(key))
      || value.schema !== 'ecc.copilot.quality.v1' || value.workspace !== input.workspace
      || value.sessionId !== input.id || !Array.isArray(value.files) || value.files.length > MAX_FILES
      || (value.calls !== undefined && (!Array.isArray(value.calls) || value.calls.length > MAX_CALLS
        || value.calls.some(call => typeof call !== 'string' || !/^[a-f0-9]{64}$/.test(call))))
      || value.files.some(item => Object.keys(item).some(key => !['path', 'version', 'checked'].includes(key))
        || typeof item.path !== 'string' || !inside(input.workspace, item.path)
        || !path.isAbsolute(item.path) || !Number.isSafeInteger(item.version) || item.version < 1
        || !Number.isSafeInteger(item.checked) || item.checked < 0 || item.checked > item.version)) {
      throw new Error('Invalid or unsupported quality store.');
    }
    return value;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { schema: 'ecc.copilot.quality.v1', workspace: input.workspace, sessionId: input.id, files: [] };
  }
}

function update(dir, input, transform) {
  const lock = path.join(dir, 'state.lock');
  const release = acquireLock(lock);
  let temp;
  try {
    const next = transform(readState(dir, input));
    const data = JSON.stringify(next);
    if (Buffer.byteLength(data) > MAX_STATE) throw new Error('Quality state quota exceeded.');
    temp = path.join(dir, `${crypto.randomBytes(12).toString('hex')}.tmp`);
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, path.join(dir, 'state.json'));
    return next;
  } finally {
    if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
    release();
  }
}

function validateTarget(workspace, file) {
  if (typeof file !== 'string' || file.includes('\0') || /[\r\n]/.test(file)) throw new Error('Invalid quality target.');
  const resolved = path.resolve(workspace, file);
  if (!inside(workspace, resolved)) throw new Error('Quality target outside workspace.');
  // A deleted target still has a parent that must not redirect outside the project.
  let ancestor = resolved;
  while (!fs.existsSync(ancestor) && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor);
  if (!inside(workspace, fs.realpathSync(ancestor))) throw new Error('Quality target resolves outside workspace.');
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe quality target.');
  }
  return resolved;
}

function accumulate(payload, env = process.env) {
  if (mode(env) === 'off') return { status: 'disabled' };
  const envelope = parseEventEnvelope('postToolUse', payload);
  if (!['Edit', 'Write'].includes(envelope.tool?.name) || envelope.outcome.status !== 'succeeded') return { status: 'unobserved' };
  const input = identity(payload);
  const args = envelope.tool.args;
  const files = [...new Set([args.file_path, ...(args.edits || []).map(edit => edit.file_path)]
    .filter(Boolean).map(file => validateTarget(input.workspace, file)).filter(file => EXTENSIONS.test(file)))];
  if (!files.length) return { status: 'ignored' };
  const dir = storeDirectory(input, env, true);
  const call = envelope.callId ? hash(envelope.callId) : null;
  let status = 'recorded';
  update(dir, input, previous => {
    if (call && previous.calls?.includes(call)) { status = 'duplicate'; return previous; }
    const merged = [...previous.files.filter(item => !files.includes(item.path)),
      ...files.map(file => ({ path: file, version: (previous.files.find(item => item.path === file)?.version || 0) + 1,
        checked: previous.files.find(item => item.path === file)?.checked || 0 }))];
    if (merged.length > MAX_FILES) throw new Error('Quality file quota exceeded.');
    return { ...previous, files: merged,
      calls: call ? [...(previous.calls || []), call].slice(-MAX_CALLS) : (previous.calls || []) };
  });
  return { status, files: status === 'recorded' ? files.length : 0 };
}

function nearestConfig(file, workspace) {
  let current = path.dirname(file);
  while (inside(workspace, current)) {
    if (fs.existsSync(path.join(current, 'tsconfig.json'))) return current;
    if (current === workspace) break;
    current = path.dirname(current);
  }
  return null;
}

// Fixed local entrypoints avoid package-manager download fallback and Windows .cmd shells.
function localTool(root, name) {
  const candidates = {
    prettier: ['prettier/bin/prettier.cjs', 'prettier/bin/prettier.js', 'prettier/bin-prettier.js'],
    biome: ['@biomejs/biome/bin/biome'], typescript: ['typescript/lib/tsc.js'],
  }[name];
  for (const candidate of candidates) {
    const file = path.join(root, 'node_modules', candidate);
    if (!fs.existsSync(file)) continue;
    const real = fs.realpathSync(file);
    if (!inside(fs.realpathSync(path.join(root, 'node_modules')), real)) throw new Error('Toolchain entrypoint leaves local node_modules.');
    return real;
  }
  return null;
}

function runTool(checkName, root, entry, args, deadline, runner) {
  if (!entry) return { check: checkName, status: 'unavailable' };
  const timeout = deadline - Date.now();
  if (timeout < 1) return { check: checkName, status: 'timeout' };
  const result = runner(process.execPath, [entry, ...args], {
    cwd: root, encoding: 'utf8', shell: false, timeout, maxBuffer: 64 * 1024,
  });
  return { check: checkName, status: result.error ? (result.error.code === 'ETIMEDOUT' ? 'timeout' : 'error')
    : result.status === 0 ? 'passed' : 'failed', exitCode: result.status ?? null };
}

function runChecks(files, workspace, qualityMode, budget, runner) {
  clearCaches();
  const deadline = Date.now() + budget;
  const formatGroups = new Map();
  const tsGroups = new Map();
  const checks = [];
  for (const file of files) {
    validateTarget(workspace, file);
    if (!fs.existsSync(file)) { checks.push({ check: 'file', status: 'deleted' }); continue; }
    const text = readBounded(file, 1024 * 1024);
    const discovered = findProjectRoot(path.dirname(file));
    const root = inside(workspace, discovered) ? discovered : workspace;
    formatGroups.set(root, [...(formatGroups.get(root) || []), file]);
    if (/\.[cm]?tsx?$/i.test(file)) {
      const tsRoot = nearestConfig(file, workspace);
      if (tsRoot) tsGroups.set(tsRoot, true);
      else checks.push({ check: 'typecheck', status: 'unavailable' });
    }
    // Same console heuristic as the canonical stop hook; report counts only, never source text.
    if (/\.[cm]?[jt]sx?$/i.test(file) && !/(?:\.test\.|\.spec\.|\.config\.|[/\\](?:scripts|__tests__|__mocks__)[/\\])/.test(file)
      && text.includes('console.log')) checks.push({ check: 'console', status: 'warning' });
    const design = designCheck({ tool_input: { file_path: file } }, { readContent: () => text });
    if (design.stderr) checks.push({ check: 'design', status: 'review-required' });
  }
  for (const [root, batch] of formatGroups) {
    const formatter = detectFormatter(root);
    const entry = formatter && localTool(root, formatter);
    const args = formatter === 'biome' ? ['check', ...(qualityMode === 'fix' ? ['--write'] : []), ...batch]
      : [qualityMode === 'fix' ? '--write' : '--check', ...batch];
    checks.push(runTool('format', root, entry, args, deadline, runner));
  }
  for (const root of tsGroups.keys()) checks.push(runTool('typecheck', root, localTool(root, 'typescript'),
    ['--noEmit', '--pretty', 'false', '--incremental', 'false', '--project', path.join(root, 'tsconfig.json')], deadline, runner));
  return checks;
}

function check(payload, env = process.env, options = {}) {
  const qualityMode = mode(env);
  if (qualityMode === 'off') return { status: 'disabled' };
  parseEventEnvelope('agentStop', payload);
  const input = identity(payload);
  const dir = storeDirectory(input, env, false);
  if (!dir) return { status: 'idle' };
  const lock = path.join(dir, 'run.lock');
  let release;
  try { release = acquireLock(lock); }
  catch (error) { if (error.code === 'EEXIST') return { status: 'busy' }; throw error; }
  try {
    const pending = readState(dir, input).files.filter(item => item.version > item.checked);
    if (!pending.length) return { status: 'idle' };
    const rawBudget = env.ECC_COPILOT_QUALITY_BUDGET_MS || '10000';
    if (!/^\d+$/.test(rawBudget) || Number(rawBudget) < 1 || Number(rawBudget) > 10000) throw new Error('Invalid quality budget (1–10000 ms).');
    const checks = runChecks(pending.map(item => item.path), input.workspace, qualityMode, Number(rawBudget), options.runner || spawnSync);
    update(dir, input, current => ({ ...current, files: current.files.map(item => {
      const observed = pending.find(previous => previous.path === item.path);
      return observed ? { ...item, checked: Math.max(item.checked, observed.version) } : item;
    }) }));
    return { status: 'checked', mode: qualityMode, files: pending.length, checks };
  } finally { release(); }
}

module.exports = { accumulate, check };
