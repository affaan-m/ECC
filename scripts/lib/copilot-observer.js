'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { analyze, validCandidate } = require('./copilot-observer-analysis');
const { readObservations } = require('./copilot-observations');
const { configRoot, projectDirectory, readBounded } = require('./copilot-sessions');
const SCHEMA = 'ecc.copilot.observer.v1';
const OWNER_SCHEMA = 'ecc.copilot.observer-worker.v1';
const MAX_BYTES = 128 * 1024;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const digest = record => hash(JSON.stringify(record));
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function directory(workspace, env, create = false) {
  const root = projectDirectory(fs.realpathSync(workspace), env, create);
  if (!root) return null;
  const dir = path.join(root, 'observer');
  try {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe observer directory.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!create) return null;
    fs.mkdirSync(dir, { mode: 0o700 });
  }
  return dir;
}
function stateFile(workspace, env = process.env, create = false) {
  const dir = directory(workspace, env, create);
  return dir && path.join(dir, 'candidates.json');
}
function readJson(file, limit = MAX_BYTES) { return JSON.parse(readBounded(file, limit)); }
function atomicWrite(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const raw = JSON.stringify(value);
    if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('Observer state quota exceeded.');
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, raw); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function mapping(workspace, env) {
  const projectId = hash(fs.realpathSync(workspace));
  let current = configRoot(env);
  for (const segment of ['ecc', 'learning-mappings']) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe observer learning mapping directory.');
  }
  const value = readJson(path.join(current, `${projectId}.json`));
  if (!exact(value, ['schema', 'observationProjectId', 'learningProjectId', 'identitySource'])
    || value.schema !== 'ecc.copilot.learning-mapping.v1' || value.observationProjectId !== projectId
    || !/^[a-f0-9]{12}$/.test(value.learningProjectId) || value.identitySource !== 'canonical-detect-project') {
    throw new Error('Invalid observer learning mapping.');
  }
  return value;
}
function readState(workspace, env = process.env) {
  const file = stateFile(workspace, env);
  if (!file) return null;
  let value;
  try { value = readJson(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!exact(value, ['schema', 'projectId', 'learningProjectId', 'backend', 'cursor', 'candidates'])
    || value.schema !== SCHEMA || value.projectId !== hash(fs.realpathSync(workspace))
    || !/^[a-f0-9]{12}$/.test(value.learningProjectId) || value.backend !== 'metadata-sequences'
    || !exact(value.cursor, ['snapshotSha256', 'lastRecordSha256', 'records'])
    || !/^[a-f0-9]{64}$/.test(value.cursor.snapshotSha256)
    || (value.cursor.lastRecordSha256 !== null && !/^[a-f0-9]{64}$/.test(value.cursor.lastRecordSha256))
    || !Number.isSafeInteger(value.cursor.records) || value.cursor.records < 0 || value.cursor.records > 2000
    || (value.cursor.records === 0) !== (value.cursor.lastRecordSha256 === null)
    || !Array.isArray(value.candidates) || value.candidates.length > 6
    || new Set(value.candidates.map(item => item?.id)).size !== value.candidates.length
    || value.candidates.some(item => !validCandidate(item))) throw new Error('Invalid observer state schema.');
  if (value.learningProjectId !== mapping(workspace, env).learningProjectId) throw new Error('Observer state learning mapping mismatch.');
  return value;
}
function runOnce(workspace, options = {}, env = process.env) {
  if (options.backend !== 'metadata-sequences') throw new Error('Explicit supported observer backend is required.');
  const canonical = fs.realpathSync(workspace);
  let bound;
  try { bound = mapping(canonical, env); } catch { throw new Error('Explicit canonical learning mapping is required before observation analysis.'); }
  const file = stateFile(canonical, env, true);
  const lock = `${file}.lock`;
  fs.mkdirSync(lock, { mode: 0o700 });
  try {
    const previous = readState(canonical, env);
    if (previous && previous.learningProjectId !== bound.learningProjectId) throw new Error('Observer mapping changed; explicit migration required.');
    const records = readObservations(canonical, env);
    const snapshotSha256 = digest(records);
    if (previous?.cursor.snapshotSha256 === snapshotSha256) return { status: 'unchanged', candidates: previous.candidates.length, backend: options.backend };
    const candidates = analyze(records);
    const rotationDetected = Boolean(previous?.cursor.lastRecordSha256
      && !records.some(record => digest(record) === previous.cursor.lastRecordSha256));
    const next = { schema: SCHEMA, projectId: bound.observationProjectId, learningProjectId: bound.learningProjectId,
      backend: options.backend, cursor: { snapshotSha256, lastRecordSha256: records.length ? digest(records.at(-1)) : null, records: records.length }, candidates };
    atomicWrite(file, next);
    return { status: 'analyzed', candidates: candidates.length, backend: options.backend, rotationDetected };
  } finally { fs.rmdirSync(lock); }
}

function exportCandidate(workspace, id, env = process.env) {
  if (typeof id !== 'string' || !/^metadata-(read|grep|glob)-before-(edit|write)$/.test(id)) throw new Error('Invalid candidate identity.');
  const state = readState(workspace, env);
  const candidate = state?.candidates.find(item => item.id === id);
  if (!candidate) throw new Error('Candidate unavailable.');
  return ['---', `id: ${candidate.id}`, `trigger: ${JSON.stringify(candidate.trigger)}`, `confidence: ${candidate.confidence}`,
    `domain: ${candidate.domain}`, `scope: ${candidate.scope}`, `source: ${candidate.source}`, `project_id: ${state.learningProjectId}`,
    '---', '', `# Candidate: ${candidate.id}`, '', '## Action', candidate.content, '', '## Evidence',
    `${candidate.evidence.sessions} distinct sessions; ${candidate.evidence.occurrences} delivered ordered pairs.`,
    'Pending human review. Tool ordering alone does not establish a beneficial preference.', ''].join('\n');
}

function workerPaths(workspace, env, create = false) {
  const dir = directory(workspace, env, create);
  if (!dir) return null;
  const lock = path.join(dir, 'worker.lock');
  return { lock, owner: path.join(lock, 'owner.json'), stop: path.join(lock, 'stop.json'), result: path.join(dir, 'worker-result.json') };
}
function readOwner(files) {
  const stat = fs.lstatSync(files.lock);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe worker lock.');
  const owner = readJson(files.owner, 4096);
  if (!exact(owner, ['schema', 'token', 'pid', 'projectId', 'backend', 'intervalMs', 'expiresAt', 'maxRuns'])
    || owner.schema !== OWNER_SCHEMA || !/^[a-f0-9]{48}$/.test(owner.token)
    || (owner.pid !== null && (!Number.isSafeInteger(owner.pid) || owner.pid <= 0))
    || !/^[a-f0-9]{64}$/.test(owner.projectId) || owner.backend !== 'metadata-sequences'
    || !Number.isSafeInteger(owner.intervalMs) || owner.intervalMs < 250 || owner.intervalMs > 300000
    || !Number.isSafeInteger(owner.expiresAt) || owner.expiresAt < 0 || owner.expiresAt > Date.now() + 3600000
    || !Number.isSafeInteger(owner.maxRuns) || owner.maxRuns < 1 || owner.maxRuns > 100) {
    throw new Error('Invalid worker owner schema.');
  }
  return owner;
}
function alive(pid) {
  if (pid === null) return null;
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; return null; }
}
function ownershipSnapshot(files) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return { kind: 'present', owner: readOwner(files) }; } catch (error) {
      if (attempt === 0 && /^Unsafe or oversized Copilot data file\.|^Copilot data file changed/.test(error.message)) continue;
      if (error.code === 'ENOENT') return { kind: fs.existsSync(files.lock) ? 'incomplete' : 'absent' };
      throw error;
    }
  }
  throw new Error('Worker ownership could not be read consistently.');
}
function status(workspace, env = process.env) {
  const files = workerPaths(workspace, env);
  if (!files) return { status: 'stopped' };
  const snapshot = ownershipSnapshot(files);
  if (snapshot.kind === 'incomplete') return { status: 'unavailable', reason: 'incomplete-worker-ownership', nativeSupervision: 'unverified' };
  if (snapshot.kind === 'absent') {
    let result;
    try { result = readJson(files.result, 4096); } catch (resultError) { if (resultError.code !== 'ENOENT') throw resultError; }
    if (result && (!exact(result, ['schema', 'token', 'finishedAt', 'status', 'runs'])
      || result.schema !== 'ecc.copilot.observer-worker-result.v1' || !/^[a-f0-9]{48}$/.test(result.token)
      || typeof result.finishedAt !== 'string' || !Number.isFinite(Date.parse(result.finishedAt))
      || !['completed', 'stopped', 'expired', 'failed'].includes(result.status)
      || !Number.isSafeInteger(result.runs) || result.runs < 0 || result.runs > 100)) throw new Error('Invalid worker result.');
    return { status: 'stopped', ...(result ? { lastResult: result } : {}) };
  }
  const owner = snapshot.owner;
  if (owner.projectId !== hash(fs.realpathSync(workspace))) throw new Error('Foreign worker owner.');
  return { status: owner.pid === null ? 'starting' : alive(owner.pid) === false ? 'stale' : 'registered',
    pid: owner.pid, token: owner.token, expiresAt: new Date(owner.expiresAt).toISOString(),
    backend: owner.backend, nativeSupervision: 'unverified', livenessMeaning: 'PID existence is not process identity attestation' };
}
function removeOwned(files, token) {
  const owner = readOwner(files);
  if (owner.token !== token) throw new Error('Worker ownership changed.');
  try { fs.unlinkSync(files.stop); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { fs.rmdirSync(path.join(files.lock, 'claim.lock')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  fs.unlinkSync(files.owner);
  fs.rmdirSync(files.lock);
}
function start(workspace, options = {}, env = process.env) {
  if (options.backend !== 'metadata-sequences') throw new Error('Explicit supported observer backend is required.');
  const canonical = fs.realpathSync(workspace);
  mapping(canonical, env);
  const intervalMs = options.intervalMs ?? 300000; const durationMs = options.durationMs ?? 1800000; const maxRuns = options.maxRuns ?? 20;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 250 || intervalMs > 300000
    || !Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 3600000
    || !Number.isSafeInteger(maxRuns) || maxRuns < 1 || maxRuns > 100) throw new Error('Observer worker limits exceeded.');
  const files = workerPaths(canonical, env, true);
  fs.mkdirSync(files.lock, { mode: 0o700 }); // Never steal an existing worker or a crash lock.
  const token = crypto.randomBytes(24).toString('hex');
  atomicWrite(files.owner, { schema: OWNER_SCHEMA, token, pid: null, projectId: hash(canonical),
    backend: options.backend, intervalMs, expiresAt: Date.now() + durationMs, maxRuns });
  try {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../copilot-observer.js'), '__worker', token], {
      cwd: canonical, env: { ...env }, stdio: 'ignore', detached: true, windowsHide: true,
    });
    child.on('error', () => { /* Start failure remains an inspectable owned lock; no PID signal is sent. */ });
    child.unref();
    return { status: 'starting', pid: child.pid ?? null, token, backend: options.backend };
  } catch (error) { removeOwned(files, token); throw error; }
}
function stop(workspace, env = process.env) {
  const files = workerPaths(workspace, env);
  if (!files) return { status: 'stopped' };
  let owner;
  try { owner = readOwner(files); } catch (error) {
    if (error.code === 'ENOENT' && !fs.existsSync(files.lock)) return { status: 'stopped' };
    throw error;
  }
  if (owner.projectId !== hash(fs.realpathSync(workspace))) throw new Error('Foreign worker owner.');
  atomicWrite(files.stop, { token: owner.token });
  return { status: 'stop-requested', token: owner.token, signalSent: false };
}
function recover(workspace, token, env = process.env) {
  const files = workerPaths(workspace, env);
  if (!files) throw new Error('No worker ownership to recover.');
  const owner = readOwner(files);
  if (owner.token !== token || owner.projectId !== hash(fs.realpathSync(workspace)) || alive(owner.pid) !== false) {
    throw new Error('Recovery requires matching ownership and a confirmed absent worker PID.');
  }
  removeOwned(files, token);
  return { status: 'recovered', signalSent: false };
}
function cancelled(files, token) {
  try {
    const value = readJson(files.stop, 4096);
    if (!exact(value, ['token']) || value.token !== token) throw new Error('Invalid worker cancellation.');
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function worker(workspace, token, env = process.env) {
  const files = workerPaths(workspace, env);
  if (!files) throw new Error('Worker ownership missing.');
  const owner = readOwner(files);
  if (owner.token !== token || owner.pid !== null || owner.projectId !== hash(fs.realpathSync(workspace))) throw new Error('Worker ownership mismatch.');
  fs.mkdirSync(path.join(files.lock, 'claim.lock'), { mode: 0o700 });
  atomicWrite(files.owner, { ...owner, pid: process.pid });
  let runs = 0; let outcome = 'completed';
  const monotonicDeadline = performance.now() + Math.max(0, Math.min(3600000, owner.expiresAt - Date.now()));
  try {
    let nextRun = 0;
    while (Date.now() < owner.expiresAt && performance.now() < monotonicDeadline && runs < owner.maxRuns) {
      if (readOwner(files).token !== token || cancelled(files, token)) { outcome = 'stopped'; break; }
      if (performance.now() >= nextRun) {
        runOnce(workspace, { backend: owner.backend }, env);
        runs++; nextRun = performance.now() + owner.intervalMs;
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(1, monotonicDeadline - performance.now()))));
    }
    if ((Date.now() >= owner.expiresAt || performance.now() >= monotonicDeadline) && runs < owner.maxRuns && outcome === 'completed') outcome = 'expired';
  } catch (error) {
    outcome = 'failed'; throw error;
  } finally {
    // An owned crash lock is preserved if replacement/corruption makes cleanup
    // uncertain. A stop request never sends an OS signal to a potentially reused PID.
    if (readOwner(files).token === token) {
      atomicWrite(files.result, { schema: 'ecc.copilot.observer-worker-result.v1', token,
        finishedAt: new Date().toISOString(), status: outcome, runs });
      removeOwned(files, token);
    }
  }
}
module.exports = { analyze, runOnce, readState, stateFile, exportCandidate, start, status, stop, recover, worker };
