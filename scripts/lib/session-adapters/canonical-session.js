'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SESSION_SCHEMA_VERSION = 'ecc.session.v1';
const SESSION_RECORDING_SCHEMA_VERSION = 'ecc.session.recording.v1';
const DEFAULT_RECORDING_DIR = path.join(os.tmpdir(), 'ecc-session-recordings');

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizePathSegment(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function parseContextSeedPaths(context) {
  if (typeof context !== 'string' || context.trim().length === 0) {
    return [];
  }

  return context
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function ensureString(value, fieldPath) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Canonical session snapshot requires ${fieldPath} to be a non-empty string`);
  }
}

function ensureStringAllowEmpty(value, fieldPath) {
  if (typeof value !== 'string') {
    throw new Error(`Canonical session snapshot requires ${fieldPath} to be a string`);
  }
}

function ensureOptionalString(value, fieldPath) {
  if (value !== null && value !== undefined && typeof value !== 'string') {
    throw new Error(`Canonical session snapshot requires ${fieldPath} to be a string or null`);
  }
}

function ensureBoolean(value, fieldPath) {
  if (typeof value !== 'boolean') {
    throw new Error(`Canonical session snapshot requires ${fieldPath} to be a boolean`);
  }
}

function ensureArrayOfStrings(value, fieldPath) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`Canonical session snapshot requires ${fieldPath} to be an array of strings`);
  }
}

function ensureInteger(value, fieldPath) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Canonical session snapshot requires ${fieldPath} to be a non-negative integer`);
  }
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

function parseUpdatedMs(updated) {
  if (typeof updated !== 'string' || updated.length === 0) return null;
  const ms = Date.parse(updated);
  return Number.isNaN(ms) ? null : ms;
}

function deriveWorkerHealth(rawWorker) {
  const state = (rawWorker.status && rawWorker.status.state) || 'unknown';
  const completedStates = ['completed', 'succeeded', 'success', 'done'];
  const failedStates = ['failed', 'error'];

  if (failedStates.includes(state)) return 'degraded';
  if (completedStates.includes(state)) return 'healthy';

  if (state === 'running' || state === 'active') {
    const pane = rawWorker.pane;
    if (pane && pane.dead) return 'degraded';

    const updatedMs = parseUpdatedMs(rawWorker.status && rawWorker.status.updated);
    if (updatedMs === null) return 'stale';
    if (Date.now() - updatedMs > STALE_THRESHOLD_MS) return 'stale';
    return 'healthy';
  }

  return 'unknown';
}

function buildAggregates(workers) {
  const states = workers.reduce((accumulator, worker) => {
    const state = worker.state || 'unknown';
    accumulator[state] = (accumulator[state] || 0) + 1;
    return accumulator;
  }, {});

  const healths = workers.reduce((accumulator, worker) => {
    const health = worker.health || 'unknown';
    accumulator[health] = (accumulator[health] || 0) + 1;
    return accumulator;
  }, {});

  return {
    workerCount: workers.length,
    states,
    healths
  };
}

function summarizeRawWorkerStates(snapshot) {
  if (isObject(snapshot.workerStates)) {
    return snapshot.workerStates;
  }

  return (snapshot.workers || []).reduce((counts, worker) => {
    const state = worker && worker.status && worker.status.state
      ? worker.status.state
      : 'unknown';
    counts[state] = (counts[state] || 0) + 1;
    return counts;
  }, {});
}

function deriveDmuxSessionState(snapshot) {
  const workerStates = summarizeRawWorkerStates(snapshot);
  const totalWorkers = Number.isInteger(snapshot.workerCount)
    ? snapshot.workerCount
    : Object.values(workerStates).reduce((sum, count) => sum + count, 0);

  if (snapshot.sessionActive) {
    return 'active';
  }

  if (totalWorkers === 0) {
    return 'missing';
  }

  const failedCount = (workerStates.failed || 0) + (workerStates.error || 0);
  if (failedCount > 0) {
    return 'failed';
  }

  const completedCount = (workerStates.completed || 0)
    + (workerStates.succeeded || 0)
    + (workerStates.success || 0)
    + (workerStates.done || 0);
  if (completedCount === totalWorkers) {
    return 'completed';
  }

  return 'idle';
}

function validateCanonicalSnapshot(snapshot) {
  if (!isObject(snapshot)) {
    throw new Error('Canonical session snapshot must be an object');
  }

  ensureString(snapshot.schemaVersion, 'schemaVersion');
  if (snapshot.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new Error(`Unsupported canonical session schema version: ${snapshot.schemaVersion}`);
  }

  ensureString(snapshot.adapterId, 'adapterId');

  if (!isObject(snapshot.session)) {
    throw new Error('Canonical session snapshot requires session to be an object');
  }

  ensureString(snapshot.session.id, 'session.id');
  ensureString(snapshot.session.kind, 'session.kind');
  ensureString(snapshot.session.state, 'session.state');
  ensureOptionalString(snapshot.session.repoRoot, 'session.repoRoot');

  if (!isObject(snapshot.session.sourceTarget)) {
    throw new Error('Canonical session snapshot requires session.sourceTarget to be an object');
  }

  ensureString(snapshot.session.sourceTarget.type, 'session.sourceTarget.type');
  ensureString(snapshot.session.sourceTarget.value, 'session.sourceTarget.value');

  if (!Array.isArray(snapshot.workers)) {
    throw new Error('Canonical session snapshot requires workers to be an array');
  }

  snapshot.workers.forEach((worker, index) => {
    if (!isObject(worker)) {
      throw new Error(`Canonical session snapshot requires workers[${index}] to be an object`);
    }

    ensureString(worker.id, `workers[${index}].id`);
    ensureString(worker.label, `workers[${index}].label`);
    ensureString(worker.state, `workers[${index}].state`);
    ensureString(worker.health, `workers[${index}].health`);
    ensureOptionalString(worker.branch, `workers[${index}].branch`);
    ensureOptionalString(worker.worktree, `workers[${index}].worktree`);

    if (!isObject(worker.runtime)) {
      throw new Error(`Canonical session snapshot requires workers[${index}].runtime to be an object`);
    }

    ensureString(worker.runtime.kind, `workers[${index}].runtime.kind`);
    ensureOptionalString(worker.runtime.command, `workers[${index}].runtime.command`);
    ensureBoolean(worker.runtime.active, `workers[${index}].runtime.active`);
    ensureBoolean(worker.runtime.dead, `workers[${index}].runtime.dead`);

    if (!isObject(worker.intent)) {
      throw new Error(`Canonical session snapshot requires workers[${index}].intent to be an object`);
    }

    ensureStringAllowEmpty(worker.intent.objective, `workers[${index}].intent.objective`);
    ensureArrayOfStrings(worker.intent.seedPaths, `workers[${index}].intent.seedPaths`);

    if (!isObject(worker.outputs)) {
      throw new Error(`Canonical session snapshot requires workers[${index}].outputs to be an object`);
    }

    ensureArrayOfStrings(worker.outputs.summary, `workers[${index}].outputs.summary`);
    ensureArrayOfStrings(worker.outputs.validation, `workers[${index}].outputs.validation`);
    ensureArrayOfStrings(worker.outputs.remainingRisks, `workers[${index}].outputs.remainingRisks`);

    if (!isObject(worker.artifacts)) {
      throw new Error(`Canonical session snapshot requires workers[${index}].artifacts to be an object`);
    }
  });

  if (!isObject(snapshot.aggregates)) {
    throw new Error('Canonical session snapshot requires aggregates to be an object');
  }

  ensureInteger(snapshot.aggregates.workerCount, 'aggregates.workerCount');
  if (snapshot.aggregates.workerCount !== snapshot.workers.length) {
    throw new Error('Canonical session snapshot requires aggregates.workerCount to match workers.length');
  }

  if (!isObject(snapshot.aggregates.states)) {
    throw new Error('Canonical session snapshot requires aggregates.states to be an object');
  }

  if (!isObject(snapshot.aggregates.healths)) {
    throw new Error('Canonical session snapshot requires aggregates.healths to be an object');
  }

  for (const [state, count] of Object.entries(snapshot.aggregates.states)) {
    ensureString(state, 'aggregates.states key');
    ensureInteger(count, `aggregates.states.${state}`);
  }

  for (const [health, count] of Object.entries(snapshot.aggregates.healths)) {
    ensureString(health, 'aggregates.healths key');
    ensureInteger(count, `aggregates.healths.${health}`);
  }

  return snapshot;
}

function resolveRecordingDir(options = {}) {
  if (typeof options.recordingDir === 'string' && options.recordingDir.length > 0) {
    return path.resolve(options.recordingDir);
  }

  if (typeof process.env.ECC_SESSION_RECORDING_DIR === 'string' && process.env.ECC_SESSION_RECORDING_DIR.length > 0) {
    return path.resolve(process.env.ECC_SESSION_RECORDING_DIR);
  }

  return DEFAULT_RECORDING_DIR;
}

function getFallbackSessionRecordingPath(snapshot, options = {}) {
  validateCanonicalSnapshot(snapshot);

  return path.join(
    resolveRecordingDir(options),
    sanitizePathSegment(snapshot.adapterId),
    `${sanitizePathSegment(snapshot.session.id)}.json`
  );
}

function readExistingRecording(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeFallbackSessionRecording(snapshot, options = {}) {
  const filePath = getFallbackSessionRecordingPath(snapshot, options);
  const recordedAt = new Date().toISOString();
  const existing = readExistingRecording(filePath);
  const snapshotChanged = !existing
    || JSON.stringify(existing.latest) !== JSON.stringify(snapshot);

  const payload = {
    schemaVersion: SESSION_RECORDING_SCHEMA_VERSION,
    adapterId: snapshot.adapterId,
    sessionId: snapshot.session.id,
    createdAt: existing && typeof existing.createdAt === 'string'
      ? existing.createdAt
      : recordedAt,
    updatedAt: recordedAt,
    latest: snapshot,
    history: Array.isArray(existing && existing.history)
      ? (snapshotChanged
          ? existing.history.concat([{ recordedAt, snapshot }])
          : existing.history)
      : [{ recordedAt, snapshot }]
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  return {
    backend: 'json-file',
    path: filePath,
    recordedAt
  };
}

function loadStateStore(options = {}) {
  if (options.stateStore) {
    return options.stateStore;
  }

  const loadStateStoreImpl = options.loadStateStoreImpl || (() => require('../state-store'));

  try {
    return loadStateStoreImpl();
  } catch (error) {
    const missingRequestedModule = error
      && error.code === 'MODULE_NOT_FOUND'
      && typeof error.message === 'string'
      && error.message.includes('../state-store');

    if (missingRequestedModule) {
      return null;
    }

    throw error;
  }
}

function resolveStateStoreWriter(stateStore) {
  if (!stateStore) {
    return null;
  }

  const candidates = [
    { owner: stateStore, fn: stateStore.persistCanonicalSessionSnapshot },
    { owner: stateStore, fn: stateStore.recordCanonicalSessionSnapshot },
    { owner: stateStore, fn: stateStore.persistSessionSnapshot },
    { owner: stateStore, fn: stateStore.recordSessionSnapshot },
    { owner: stateStore, fn: stateStore.writeSessionSnapshot },
    {
      owner: stateStore.sessions,
      fn: stateStore.sessions && stateStore.sessions.persistCanonicalSessionSnapshot
    },
    {
      owner: stateStore.sessions,
      fn: stateStore.sessions && stateStore.sessions.recordCanonicalSessionSnapshot
    },
    {
      owner: stateStore.sessions,
      fn: stateStore.sessions && stateStore.sessions.persistSessionSnapshot
    },
    {
      owner: stateStore.sessions,
      fn: stateStore.sessions && stateStore.sessions.recordSessionSnapshot
    }
  ];

  const writer = candidates.find(candidate => typeof candidate.fn === 'function');
  return writer ? writer.fn.bind(writer.owner) : null;
}

function persistCanonicalSnapshot(snapshot, options = {}) {
  validateCanonicalSnapshot(snapshot);

  if (options.persist === false) {
    return {
      backend: 'skipped',
      path: null,
      recordedAt: null
    };
  }

  const stateStore = loadStateStore(options);
  const writer = resolveStateStoreWriter(stateStore);

  if (stateStore && !writer) {
    // The loaded object is a factory module (e.g. has createStateStore but no
    // writer methods).  Treat it the same as a missing state store and fall
    // through to the JSON-file recording path below.
    return writeFallbackSessionRecording(snapshot, options);
  }

  if (writer) {
    writer(snapshot, {
      adapterId: snapshot.adapterId,
      schemaVersion: snapshot.schemaVersion,
      sessionId: snapshot.session.id
    });

    return {
      backend: 'state-store',
      path: null,
      recordedAt: null
    };
  }

  return writeFallbackSessionRecording(snapshot, options);
}

function normalizeDmuxSnapshot(snapshot, sourceTarget) {
  const workers = (snapshot.workers || []).map(worker => ({
    id: worker.workerSlug,
    label: worker.workerSlug,
    state: worker.status.state || 'unknown',
    health: deriveWorkerHealth(worker),
    branch: worker.status.branch || null,
    worktree: worker.status.worktree || null,
    runtime: {
      kind: 'tmux-pane',
      command: worker.pane ? worker.pane.currentCommand || null : null,
      pid: worker.pane ? worker.pane.pid || null : null,
      active: worker.pane ? Boolean(worker.pane.active) : false,
      dead: worker.pane ? Boolean(worker.pane.dead) : false,
    },
    intent: {
      objective: worker.task.objective || '',
      seedPaths: Array.isArray(worker.task.seedPaths) ? worker.task.seedPaths : []
    },
    outputs: {
      summary: Array.isArray(worker.handoff.summary) ? worker.handoff.summary : [],
      validation: Array.isArray(worker.handoff.validation) ? worker.handoff.validation : [],
      remainingRisks: Array.isArray(worker.handoff.remainingRisks) ? worker.handoff.remainingRisks : []
    },
    artifacts: {
      statusFile: worker.files.status,
      taskFile: worker.files.task,
      handoffFile: worker.files.handoff
    }
  }));

  return validateCanonicalSnapshot({
    schemaVersion: SESSION_SCHEMA_VERSION,
    adapterId: 'dmux-tmux',
    session: {
      id: snapshot.sessionName,
      kind: 'orchestrated',
      state: deriveDmuxSessionState(snapshot),
      repoRoot: snapshot.repoRoot || null,
      sourceTarget
    },
    workers,
    aggregates: buildAggregates(workers)
  });
}

function deriveClaudeWorkerId(session) {
  if (session.shortId && session.shortId !== 'no-id') {
    return session.shortId;
  }

  return path.basename(session.filename || session.sessionPath || 'session', '.tmp');
}

function normalizeClaudeHistorySession(session, sourceTarget) {
  const metadata = session.metadata || {};
  const workerId = deriveClaudeWorkerId(session);
  const worker = {
    id: workerId,
    label: metadata.title || session.filename || workerId,
    state: 'recorded',
    health: 'healthy',
    branch: metadata.branch || null,
    worktree: metadata.worktree || null,
    runtime: {
      kind: 'claude-session',
      command: 'claude',
      pid: null,
      active: false,
      dead: true,
    },
    intent: {
      objective: metadata.inProgress && metadata.inProgress.length > 0
        ? metadata.inProgress[0]
        : (metadata.title || ''),
      seedPaths: parseContextSeedPaths(metadata.context)
    },
    outputs: {
      summary: Array.isArray(metadata.completed) ? metadata.completed : [],
      validation: [],
      remainingRisks: metadata.notes ? [metadata.notes] : []
    },
    artifacts: {
      sessionFile: session.sessionPath,
      context: metadata.context || null
    }
  };

  return validateCanonicalSnapshot({
    schemaVersion: SESSION_SCHEMA_VERSION,
    adapterId: 'claude-history',
    session: {
      id: workerId,
      kind: 'history',
      state: 'recorded',
      repoRoot: metadata.worktree || null,
      sourceTarget
    },
    workers: [worker],
    aggregates: buildAggregates([worker])
  });
}

function normalizeCodexWorktreeSession(session, sourceTarget) {
  const state = session.active ? 'active' : 'recorded';
  const objective = typeof session.objective === 'string' ? session.objective : '';
  const worker = {
    id: session.sessionId,
    label: session.sessionId,
    state,
    health: 'healthy',
    branch: session.branch || null,
    worktree: session.cwd || null,
    runtime: {
      kind: 'codex-session',
      command: 'codex',
      pid: null,
      active: Boolean(session.active),
      dead: !session.active,
    },
    intent: {
      objective,
      seedPaths: []
    },
    outputs: {
      summary: [],
      validation: [],
      remainingRisks: []
    },
    artifacts: {
      sessionFile: session.sessionPath || null,
      model: session.model || null,
      originator: session.originator || null,
      cliVersion: session.cliVersion || null,
      startedAt: session.startedAt || null,
      recordCount: Number.isInteger(session.recordCount) ? session.recordCount : null
    }
  };

  return validateCanonicalSnapshot({
    schemaVersion: SESSION_SCHEMA_VERSION,
    adapterId: 'codex-worktree',
    session: {
      id: session.sessionId,
      kind: 'codex-worktree',
      state,
      repoRoot: session.cwd || null,
      sourceTarget
    },
    workers: [worker],
    aggregates: buildAggregates([worker])
  });
}

function normalizeOpencodeSession(session, sourceTarget) {
  const state = session.active ? 'active' : 'recorded';
  const objective = typeof session.objective === 'string' ? session.objective : '';
  const worker = {
    id: session.sessionId,
    label: session.title || session.sessionId,
    state,
    health: 'healthy',
    branch: session.branch || null,
    worktree: session.cwd || null,
    runtime: {
      kind: 'opencode-session',
      command: 'opencode',
      pid: null,
      active: Boolean(session.active),
      dead: !session.active,
    },
    intent: {
      objective,
      seedPaths: []
    },
    outputs: {
      summary: [],
      validation: [],
      remainingRisks: []
    },
    artifacts: {
      sessionFile: session.sessionPath || null,
      projectId: session.projectId || null,
      version: session.version || null,
      model: session.model || null,
      provider: session.provider || null,
      title: session.title || null,
      createdAt: session.createdAt || null,
      updatedAt: session.updatedAt || null,
      messageCount: Number.isInteger(session.messageCount) ? session.messageCount : null
    }
  };

  return validateCanonicalSnapshot({
    schemaVersion: SESSION_SCHEMA_VERSION,
    adapterId: 'opencode',
    session: {
      id: session.sessionId,
      kind: 'opencode',
      state,
      repoRoot: session.cwd || null,
      sourceTarget
    },
    workers: [worker],
    aggregates: buildAggregates([worker])
  });
}

module.exports = {
  SESSION_SCHEMA_VERSION,
  buildAggregates,
  getFallbackSessionRecordingPath,
  normalizeClaudeHistorySession,
  normalizeCodexWorktreeSession,
  normalizeDmuxSnapshot,
  normalizeOpencodeSession,
  persistCanonicalSnapshot,
  validateCanonicalSnapshot
};
