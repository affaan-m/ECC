'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { collisionRisk } = require('./agent-proximity/distance');
const { buildDependencyGraphFromSources } = require('./agent-proximity/graph');
const { parseWorkerStatus } = require('./orchestration-session');

const MAX_BYTES = 1024 * 1024;
const STALE_MS = 5 * 60 * 1000;
function invalid() { throw new Error('Invalid coordination input.'); }
function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value;
}
function list(value, max = 64) {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}
function text(value, max = 200) {
  if (typeof value !== 'string' || !value.length || value.length > max || [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) invalid();
  return value;
}
function missing(value) { return value === null || value === undefined; }
function identifier(value) {
  text(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) invalid();
  return value;
}
function timestamp(value) {
  text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) invalid();
  const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction || '').padEnd(3, '0')}Z`);
  if (new Date(value).toISOString() !== canonical) invalid();
  return value;
}
function relativePath(value) {
  const p = text(value, 1024).replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = p.split('/');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || parts.some(x => !x || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(x))) invalid();
  return p;
}
function unique(items, key) {
  if (new Set(items.map(x => x[key])).size !== items.length) invalid();
  return items;
}
function normalizeTask(value) {
  const t = record(value);
  if (!missing(t.pid) && (!Number.isSafeInteger(t.pid) || t.pid <= 0)) invalid();
  const id = identifier(t.id);
  const parentId = t.parentId ? identifier(t.parentId) : null;
  if (parentId === id) invalid();
  return {
    id, parentId, repoId: missing(t.repoId) ? null : identifier(t.repoId),
    paths: [...new Set(list(t.paths || [], 128).map(relativePath))].sort(),
    pid: t.pid ?? null, status: missing(t.status) ? 'unknown' : text(t.status),
    heartbeatAt: missing(t.heartbeatAt) ? null : timestamp(t.heartbeatAt),
    statusFileModifiedAt: missing(t.statusFileModifiedAt) ? null : timestamp(t.statusFileModifiedAt)
  };
}
function declarationStatus(value, allowed) {
  if (value === undefined) return 'unknown';
  if (!allowed.includes(value)) invalid();
  return value;
}
function normalizeDeclarations(manifest, tasks) {
  const taskIds = new Set(tasks.map(t => t.id));
  const link = (value, ids) => {
    if (missing(value)) return null;
    const id = identifier(value);
    if (!ids.has(id)) invalid();
    return id;
  };
  const common = value => ({ id: identifier(value.id), taskId: link(value.taskId, taskIds),
    updatedAt: missing(value.updatedAt) ? null : timestamp(value.updatedAt) });
  const goals = unique(list(manifest.goals === undefined ? [] : manifest.goals).map(value => {
    const g = record(value);
    return { ...common(g), kind: declarationStatus(g.kind, ['native', 'unknown']),
      status: declarationStatus(g.status, ['active', 'complete', 'blocked', 'unknown']) };
  }), 'id');
  const goalIds = new Set(goals.map(g => g.id));
  const sessions = unique(list(manifest.sessions === undefined ? [] : manifest.sessions).map(value => {
    const s = record(value);
    return { ...common(s), goalId: link(s.goalId, goalIds),
      status: declarationStatus(s.status, ['open', 'closed', 'unknown']) };
  }), 'id');
  return { goals, sessions, declarationCoverage: {
    goals: manifest.goals === undefined ? 'missing' : 'declared-only',
    sessions: manifest.sessions === undefined ? 'missing' : 'declared-only'
  } };
}
function normalizeManifest(value) {
  const m = record(value);
  if (m.version !== 1 || Buffer.byteLength(JSON.stringify(m)) > MAX_BYTES) invalid();
  let sourceBytes = 0;
  const repositories = unique(list(m.repositories ?? []).map(value => {
    const r = record(value); const sourceEntries = Object.entries(record(r.sources ?? {}));
    if (sourceEntries.length > 128) invalid();
    const entries = sourceEntries.map(([p, source]) => {
      // Existing regex extractor is for snippets, not arbitrary full source files.
      if (typeof source !== 'string' || Buffer.byteLength(source) > 1024) invalid();
      sourceBytes += Buffer.byteLength(source);
      if (sourceBytes > 32768) invalid();
      return [relativePath(p), source];
    });
    if (new Set(entries.map(([p]) => p)).size !== entries.length) invalid();
    return { id: identifier(r.id), sources: Object.fromEntries(entries) };
  }), 'id');
  const tasks = unique(list(m.tasks).map(normalizeTask), 'id');
  const ids = new Set(repositories.map(r => r.id));
  if (tasks.some(t => t.repoId !== null && !ids.has(t.repoId))) invalid();
  const leases = list(m.leases ?? [], 128).map(value => {
    const l = record(value);
    return { resource: identifier(l.resource), owner: identifier(l.owner), expiresAt: timestamp(l.expiresAt) };
  });
  return { version: 1, repositories, tasks, leases, ...normalizeDeclarations(m, tasks) };
}

function heartbeat(value, nowMs) {
  if (!value) return { state: 'unknown', ageMs: null };
  const ageMs = nowMs - Date.parse(value);
  return { state: ageMs < 0 ? 'clock-skew' : ageMs > STALE_MS ? 'stale' : 'fresh', ageMs };
}
function declarationInventory(manifest, nowMs) {
  const observe = item => ({ ...item, authority: 'declared-only', freshness: heartbeat(item.updatedAt, nowMs) });
  const goals = manifest.goals.map(observe);
  const sessions = manifest.sessions.map(observe);
  const counts = (items, statuses) => Object.fromEntries(statuses.map(status =>
    [status, items.filter(item => item.status === status).length]));
  const statuses = ['active', 'complete', 'blocked', 'unknown'];
  const native = goals.filter(g => g.kind === 'native');
  return { goals, sessions, activity: {
    declaredGoalsByStatus: counts(goals, statuses),
    declaredNativeGoalsByStatus: counts(native, statuses),
    declaredSessionsByStatus: counts(sessions, ['open', 'closed', 'unknown']),
    openSessionsWithoutGoalDeclaration: sessions.filter(s => s.status === 'open' && s.goalId === null).length,
    freshActiveNativeGoalDeclarations: native.filter(g => g.status === 'active' && g.freshness.state === 'fresh').length
  } };
}
function proximityWarnings(manifest) {
  const warnings = [];
  let workBudget = 200000;
  for (const repo of manifest.repositories) {
    const tasks = manifest.tasks.filter(t => t.repoId === repo.id && t.paths.length > 0).sort((a,b) => a.id < b.id ? -1 : 1);
    if (tasks.length < 2) continue;
    const parsed = buildDependencyGraphFromSources(repo.sources);
    const graph = { ...parsed, adjacency: Object.assign(Object.create(null), parsed.adjacency) };
    const graphCost = 1 + graph.files.length + Object.values(graph.adjacency).reduce((sum, edges) => sum + edges.length, 0);
    const pathPairs = tasks.reduce((sum, task, i) => sum + task.paths.length * tasks.slice(i + 1).reduce((n, other) => n + other.paths.length, 0), 0);
    workBudget -= pathPairs * graphCost;
    if (workBudget < 0) throw new Error('Inventory comparison budget exceeded; split the manifest.');
    for (let i = 0; i < tasks.length; i += 1) {
      for (let j = i + 1; j < tasks.length; j += 1) {
        const a = tasks[i]; const b = tasks[j];
        const score = collisionRisk({ files: a.paths.map(p => ({ path: p })) }, { files: b.paths.map(p => ({ path: p })) }, graph);
        if (score.risk < 0.35) continue;
        const reasons = [];
        if (score.channels.overlap) reasons.push('path_overlap');
        if (score.channels.dependency) reasons.push('import_dependency');
        warnings.push({ repoId: repo.id, tasks: [a.id, b.id], reasons, score: score.risk, channels: score.channels, action: 'review-declared-work' });
      }
    }
  }
  return warnings;
}
function buildInventory(input, options = {}) {
  const m = normalizeManifest(input);
  const now = timestamp(options.now || new Date().toISOString());
  const nowMs = Date.parse(now);
  const resources = options.resources || { memory: null, processStatus: 'not-requested', processes: [] };
  const processes = new Map(resources.processes.map(p => [p.pid, p]));
  const tasks = m.tasks.map(t => ({ ...t, heartbeat: heartbeat(t.heartbeatAt, nowMs),
    process: processes.has(t.pid) ? { ...processes.get(t.pid), state: 'observed' }
      : { state: t.pid && resources.processStatus === 'ok' ? 'not-observed' : 'unknown' }
  }));
  const leases = m.leases.map(l => ({ ...l, state: Date.parse(l.expiresAt) > nowMs ? 'unexpired' : 'expired', authority: 'declared-only' }));
  const active = new Map();
  for (const l of leases.filter(l => l.state === 'unexpired')) {
    active.set(l.resource, new Set([...(active.get(l.resource) || []), l.owner]));
  }
  const leaseConflicts = [...active].filter(([,owners]) => owners.size > 1)
    .map(([resource,owners]) => ({ resource, owners: [...owners].sort() })).sort((a,b) => a.resource < b.resource ? -1 : 1);
  return {
    version: 1, mode: 'read-only', observedAt: now, tasks, leases, leaseConflicts,
    ...declarationInventory(m, nowMs),
    resources, warnings: proximityWarnings(m),
    coverage: { tasks: 'declared-or-status-files-only', workingSets: 'declared-paths-only', imports: 'provided-source-map-relative-js-ts-only', leases: 'declared-only', processes: 'declared-pids-only', ...m.declarationCoverage },
    limits: ['Score is a heuristic, not a calibrated probability.', 'No warning does not establish collision-free work.',
      'Goal/session states and native kind are caller declarations, not verified execution or authority.',
      'Open sessions, task status and observed PIDs do not establish an active native goal.',
      'Missing declarations and empty lists do not establish global absence; fresh declarations do not prove current execution.',
      'Stale heartbeat is not proof of a stuck process; PID reuse is not resolved.',
      'Import regex may match comments and misses aliases, nonliteral and non-JS imports.',
      'No semantic/PCA proximity or conflict-reduction claim is validated.',
      'Leases are observations, not locks or permission grants.']
  };
}

function collectResources(tasks, deps = {}) {
  const memory = { totalBytes: (deps.totalmem || os.totalmem)(), freeBytes: (deps.freemem || os.freemem)(),
    source: 'os', note: 'OS free memory is not application headroom or macOS memory pressure.' };
  const pids = [...new Set(tasks.map(t => t.pid).filter(pid => Number.isSafeInteger(pid) && pid > 0))];
  if (!pids.length) return { memory, processStatus: 'not-requested', processes: [] };
  if (!['darwin', 'linux'].includes(deps.platform || process.platform)) return { memory, processStatus: 'unsupported', processes: [] };
  try {
    const result = (deps.execFileSync || execFileSync)('ps', ['-p', pids.join(','), '-o', 'pid=,ppid=,rss=,etime=,stat='],
      { encoding: 'utf8', timeout: 2000, maxBuffer: 65536, shell: false, stdio: ['ignore','pipe','pipe'] });
    const processes = String(result).split('\n').filter(l => l.trim()).map(line => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d:-]+)\s+([A-Za-z+<>NsElLW]+)$/);
      if (!match) throw new Error('Invalid process metadata.');
      const values = match.slice(1,4).map(Number);
      if (values.some(v => !Number.isSafeInteger(v)) || !pids.includes(values[0])) throw new Error('Invalid process metadata.');
      return { pid: values[0], parentPid: values[1], rssBytes: values[2] * 1024, elapsed: match[4], flags: match[5] };
    });
    return { memory, processStatus: 'ok', processes };
  } catch { return { memory, processStatus: 'unavailable', processes: [] }; }
}

function readBounded(file, limit = MAX_BYTES) {
  // Refuse symlink final components, devices and files beyond the byte budget.
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error('Input exceeds file limit.');
    const buffer = Buffer.alloc(limit + 1);
    let size = 0; let count;
    do { count = fs.readSync(fd, buffer, size, buffer.length - size, null); size += count; } while (count && size < buffer.length);
    if (size > limit) throw new Error('Input exceeds file limit.');
    return { content: buffer.subarray(0,size).toString('utf8'), modifiedAt: stat.mtime.toISOString() };
  } finally { fs.closeSync(fd); }
}
function readJson(file) {
  try { return JSON.parse(readBounded(file).content); }
  catch (error) { throw new Error(error.message === 'Input exceeds file limit.' ? error.message : 'Cannot read coordination JSON.'); }
}
function collectTaskFiles(directory) {
  try {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).sort((a,b) => a.name < b.name ? -1 : 1);
    if (entries.length > 64) throw new Error('Too many task directories.');
    const tasks = []; const unreadable = [];
    for (const entry of entries) {
      let loaded = false;
      for (const name of ['STATUS.md', 'status.md']) {
        try {
          const data = readBounded(path.join(directory, entry.name, name), 65536);
          const parsed = parseWorkerStatus(data.content);
          let heartbeatAt = null;
          try { if (parsed.updated) heartbeatAt = timestamp(parsed.updated); } catch { /* Unknown timestamp, not a heartbeat. */ }
          tasks.push(normalizeTask({ id: entry.name, paths: [], status: parsed.state || 'unknown', heartbeatAt, statusFileModifiedAt: data.modifiedAt }));
          loaded = true; break;
        } catch { /* Try legacy lowercase status filename; report unreadable below. */ }
      }
      if (!loaded) unreadable.push(entry.name);
    }
    return { status: unreadable.length ? 'partial' : 'ok', tasks, unreadable };
  } catch { return { status: 'unavailable', tasks: [], unreadable: [] }; }
}

module.exports = { normalizeManifest, buildInventory, collectResources, collectTaskFiles, readJson };
