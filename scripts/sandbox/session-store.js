'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUN_ID_PATTERN = /^run_[a-f0-9]{32}$/;
const CONTROL_ID_PATTERN = /^ctl_[a-f0-9]{24}$/;
const SUPPORTED_CONTROLS = new Set([
  'continue', 'inspect', 'pause-next', 'stop', 'ui-ready', 'ui-detached',
]);
const MAX_EVENT_TEXT_BYTES = 64 * 1024;
const MAX_OUTPUT_EVENTS = 5_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const REDACTION_PATTERNS = [
  /\b(?:token|password|passwd|secret|api[_-]?key)\s*[=:]\s*[^\s]+/gi,
  /\bAWS_(?:SECRET_ACCESS_KEY|ACCESS_KEY_ID|SESSION_TOKEN)\s*=\s*[^\s]+/gi,
  /\b[A-Z][A-Z0-9_]*(?:TOKEN|PASSWORD|PASSWD|SECRET|API_KEY|AUTHORIZATION|COOKIE)\s*=\s*[^\s]+/g,
  /["'](?:token|password|passwd|secret|api[_-]?key)["']\s*:\s*["'][^"']+["']/gi,
  /:\/\/[^\s/@:]+:[^\s/@]+@/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];
const LOCK_TIMEOUT_MS = 5_000;

function defaultStateRoot() {
  const stateRoot = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(stateRoot, 'ecc', 'sandbox', 'runs');
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  return directory;
}

function validateRunId(runId) {
  if (!RUN_ID_PATTERN.test(String(runId || ''))) {
    throw new Error('Invalid sandbox run ID');
  }
  return runId;
}

function validateStateRoot(root) {
  const raw = String(root || '');
  // State paths must reject every C0 control byte and DEL explicitly.
  // eslint-disable-next-line no-control-regex
  if (!raw || /[\0-\x1f\x7f]/.test(raw)) {
    throw new Error('Sandbox state root must be non-empty and contain no control characters');
  }
  const resolved = path.resolve(raw);
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error('Sandbox state root must not be a symbolic link');
  }
  let existing = resolved;
  while (!fs.existsSync(existing) && existing !== path.dirname(existing)) existing = path.dirname(existing);
  const canonicalParent = fs.realpathSync.native(existing);
  return path.join(canonicalParent, path.relative(existing, resolved));
}

function resolveRunDirectory(runId, root = defaultStateRoot()) {
  validateRunId(runId);
  return path.join(validateStateRoot(root), runId);
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  ensurePrivateDirectory(directory);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600, flag: 'wx',
  });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

function readJson(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label} is unavailable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  if (stat.size > 4 * 1024 * 1024) throw new Error(`${label} exceeds the 4 MiB limit`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withRunLock(runDirectory, operation) {
  const lockPath = path.join(runDirectory, '.state-lock');
  const started = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        stale = Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_TIMEOUT_MS * 2;
      } catch {
        continue;
      }
      if (stale) {
        try { fs.rmdirSync(lockPath); } catch { /* another writer recovered it */ }
        continue;
      }
      if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error('Sandbox state lock timed out');
      sleep(10);
    }
  }
  try {
    return operation();
  } finally {
    try { fs.rmdirSync(lockPath); } catch { /* a stale-lock recovery already removed it */ }
  }
}

function writeStateUnlocked(runDirectory, runId, state, updates) {
  const next = {
    ...state,
    ...updates,
    schema_version: 1,
    run_id: runId,
    updated_at: new Date().toISOString(),
  };
  writeJsonAtomic(path.join(runDirectory, 'state.json'), next);
  return next;
}

function createRun(options) {
  const root = ensurePrivateDirectory(validateStateRoot(options.root || defaultStateRoot()));
  const runId = `run_${crypto.randomBytes(16).toString('hex')}`;
  const runDirectory = resolveRunDirectory(runId, root);
  ensurePrivateDirectory(runDirectory);
  ensurePrivateDirectory(path.join(runDirectory, 'controls'));
  ensurePrivateDirectory(path.join(runDirectory, 'responses'));
  const now = options.now || Date.now();
  const session = {
    schema_version: 1,
    run_id: runId,
    owner_token: crypto.randomBytes(32).toString('hex'),
    created_at: new Date(now).toISOString(),
    created_ms: now,
    manifest_path: path.resolve(options.manifestPath),
    original_manifest_path: path.resolve(options.originalManifestPath || options.manifestPath),
    manifest_digest: options.manifestDigest,
    workspace_path: path.resolve(options.workspacePath || process.cwd()),
    route: { ...options.route },
    terminal: options.terminal || 'wezterm',
    record: options.record === true,
    pause_review: options.pauseReview !== false,
    local_only: options.localOnly === true,
    capabilities_path: options.capabilitiesPath ? path.resolve(options.capabilitiesPath) : null,
    capabilities_digest: options.capabilitiesDigest || null,
    mock_path: options.mockPath ? path.resolve(options.mockPath) : null,
    mock_digest: options.mockDigest || null,
    source_run_id: options.sourceRunId || null,
    exploration: options.exploration === true,
    requested_report: options.requestedReport || null,
    purpose: options.purpose || null,
    consent: options.consent ? { ...options.consent } : null,
  };
  const state = {
    schema_version: 1,
    run_id: runId,
    status: 'created',
    pause: null,
    next_seq: 1,
    next_control_seq: 1,
    output_events: 0,
    output_bytes: 0,
    dropped_output_events: 0,
    dropped_output_bytes: 0,
    ui_connected: false,
    supervisor_pid: null,
    launch_watchdog_pid: null,
    updated_at: new Date(now).toISOString(),
  };
  writeJsonAtomic(path.join(runDirectory, 'session.json'), session);
  writeJsonAtomic(path.join(runDirectory, 'state.json'), state);
  fs.writeFileSync(path.join(runDirectory, 'events.jsonl'), '', { mode: 0o600, flag: 'wx' });
  return { run_id: runId, run_directory: runDirectory, session, state };
}

function readRun(runId, root = defaultStateRoot()) {
  const runDirectory = resolveRunDirectory(runId, root);
  return {
    run_directory: runDirectory,
    session: readJson(path.join(runDirectory, 'session.json'), 'Sandbox session'),
    state: readJson(path.join(runDirectory, 'state.json'), 'Sandbox state'),
  };
}

function updateState(runId, root, updates) {
  const runDirectory = resolveRunDirectory(runId, root);
  return withRunLock(runDirectory, () => {
    const state = readJson(path.join(runDirectory, 'state.json'), 'Sandbox state');
    return writeStateUnlocked(runDirectory, runId, state, updates);
  });
}

function transitionState(runId, root, expectedStatus, updates) {
  const runDirectory = resolveRunDirectory(runId, root);
  return withRunLock(runDirectory, () => {
    const state = readJson(path.join(runDirectory, 'state.json'), 'Sandbox state');
    if (state.status !== expectedStatus) return { updated: false, state };
    return {
      updated: true,
      state: writeStateUnlocked(runDirectory, runId, state, updates),
    };
  });
}

function redactText(value) {
  const original = String(value || '');
  let text = original;
  let count = 0;
  for (const pattern of REDACTION_PATTERNS) {
    text = text.replace(pattern, () => {
      count += 1;
      return '[REDACTED]';
    });
  }
  const encoded = Buffer.from(text, 'utf8');
  const retained = encoded.length > MAX_EVENT_TEXT_BYTES
    ? encoded.subarray(encoded.length - MAX_EVENT_TEXT_BYTES).toString('utf8')
    : text;
  return {
    text: retained,
    original_bytes: Buffer.byteLength(original),
    retained_bytes: Buffer.byteLength(retained),
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    redaction_count: count,
    truncated: encoded.length > MAX_EVENT_TEXT_BYTES,
  };
}

function writeJournalEntry(runDirectory, entry) {
  const journalPath = path.join(runDirectory, 'events.jsonl');
  const journal = fs.openSync(
    journalPath,
    fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW
  );
  try {
    fs.writeFileSync(journal, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' });
  } finally {
    fs.closeSync(journal);
  }
}

function appendEventUnlocked(runDirectory, runId, session, state, event, timing, updates = {}) {
  const textEvidence = Object.prototype.hasOwnProperty.call(event, 'text')
    ? redactText(event.text)
    : {};
  const isOutput = typeof event.type === 'string' && event.type.endsWith('.output');
  if (
    isOutput
    && (
      state.output_events >= MAX_OUTPUT_EVENTS
      || state.output_bytes + (textEvidence.retained_bytes || 0) > MAX_OUTPUT_BYTES
    )
  ) {
    const nextState = writeStateUnlocked(runDirectory, runId, state, {
      ...updates,
      dropped_output_events: (state.dropped_output_events || 0) + 1,
      dropped_output_bytes: (state.dropped_output_bytes || 0) + (textEvidence.original_bytes || 0),
    });
    return { entry: null, state: nextState };
  }
  const entry = {
    schema_version: 1,
    run_id: runId,
    seq: state.next_seq,
    timestamp: new Date(timing.now || Date.now()).toISOString(),
    elapsed_ms: Math.max(0, Math.round(timing.monotonicMs || 0)),
    backend: session.route.backend,
    tier: session.route.tier,
    ...sanitizeValue(event),
    ...textEvidence,
  };
  writeJournalEntry(runDirectory, entry);
  const nextState = writeStateUnlocked(runDirectory, runId, state, {
    ...updates,
    next_seq: entry.seq + 1,
    output_events: state.output_events + (isOutput ? 1 : 0),
    output_bytes: state.output_bytes + (isOutput ? (textEvidence.retained_bytes || 0) : 0),
  });
  return { entry, state: nextState };
}

function appendEvent(runId, root, event, timing = {}) {
  const runDirectory = resolveRunDirectory(runId, root);
  return withRunLock(runDirectory, () => {
    const session = readJson(path.join(runDirectory, 'session.json'), 'Sandbox session');
    const state = readJson(path.join(runDirectory, 'state.json'), 'Sandbox state');
    return appendEventUnlocked(
      runDirectory, runId, session, state, event, timing
    ).entry;
  });
}

function transitionStateWithEvent(runId, root, expectedStatus, updates, event, timing = {}) {
  const runDirectory = resolveRunDirectory(runId, root);
  return withRunLock(runDirectory, () => {
    const session = readJson(path.join(runDirectory, 'session.json'), 'Sandbox session');
    const state = readJson(path.join(runDirectory, 'state.json'), 'Sandbox state');
    if (state.status !== expectedStatus) return { updated: false, state, event: null };
    const written = appendEventUnlocked(
      runDirectory, runId, session, state, event, timing, updates
    );
    return { updated: true, state: written.state, event: written.entry };
  });
}

function listEvents(runId, root = defaultStateRoot()) {
  const runDirectory = resolveRunDirectory(runId, root);
  const content = fs.readFileSync(path.join(runDirectory, 'events.jsonl'), 'utf8');
  return content.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function readEventsSince(runId, root = defaultStateRoot(), offset = 0) {
  const runDirectory = resolveRunDirectory(runId, root);
  const journalPath = path.join(runDirectory, 'events.jsonl');
  const size = fs.statSync(journalPath).size;
  const start = Number.isInteger(offset) && offset >= 0 && offset <= size ? offset : 0;
  if (size === start) return { events: [], offset: size };
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const descriptor = fs.openSync(journalPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    fs.readSync(descriptor, buffer, 0, length, start);
  } finally {
    fs.closeSync(descriptor);
  }
  const text = buffer.toString('utf8');
  return {
    events: text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)),
    offset: size,
  };
}

function createControl(runId, root, action, payload = {}) {
  if (!SUPPORTED_CONTROLS.has(action)) throw new Error(`Unsupported sandbox control: ${action}`);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Sandbox control payload must be an object');
  }
  const safePayload = sanitizeValue(payload);
  if (Buffer.byteLength(JSON.stringify(safePayload), 'utf8') > 64 * 1024) {
    throw new Error('Sandbox control payload exceeds 64 KiB');
  }
  const runDirectory = resolveRunDirectory(runId, root);
  return withRunLock(runDirectory, () => {
    const session = readJson(path.join(runDirectory, 'session.json'), 'Sandbox session');
    const state = readJson(path.join(runDirectory, 'state.json'), 'Sandbox state');
    const controlId = `ctl_${crypto.randomBytes(12).toString('hex')}`;
    const control = {
      schema_version: 1, control_id: controlId, run_id: runId,
      owner_token: session.owner_token, action, payload: safePayload,
      created_seq: state.next_control_seq, created_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(runDirectory, 'controls', `${controlId}.json`), `${JSON.stringify(control)}\n`, {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    });
    writeStateUnlocked(runDirectory, runId, state, { next_control_seq: state.next_control_seq + 1 });
    return control;
  });
}

function writeResource(runId, root, resource) {
  const runDirectory = resolveRunDirectory(runId, root);
  return withRunLock(runDirectory, () => {
    const session = readJson(path.join(runDirectory, 'session.json'), 'Sandbox session');
    const state = readJson(path.join(runDirectory, 'state.json'), 'Sandbox state');
    if (!resource || resource.owner_token !== session.owner_token) {
      throw new Error('Sandbox resource owner token does not match the session');
    }
    const resourcePath = path.join(runDirectory, 'resource.json');
    const existing = fs.existsSync(resourcePath)
      ? readJson(resourcePath, 'Sandbox resource receipt').resources || []
      : [];
    const receipt = { ...resource, updated_at: new Date().toISOString() };
    const key = `${receipt.kind}:${receipt.name || receipt.pid || ''}`;
    const resources = existing.filter(item => `${item.kind}:${item.name || item.pid || ''}` !== key);
    resources.push(receipt);
    writeJsonAtomic(resourcePath, { schema_version: 1, run_id: runId, resources });
    writeStateUnlocked(runDirectory, runId, state, {
      resources: resources.map(item => ({ kind: item.kind, name: item.name || null })),
    });
    return receipt;
  });
}

function readResources(runId, root = defaultStateRoot()) {
  const runDirectory = resolveRunDirectory(runId, root);
  const resourcePath = path.join(runDirectory, 'resource.json');
  if (!fs.existsSync(resourcePath)) return [];
  return readJson(resourcePath, 'Sandbox resource receipt').resources || [];
}

function readResource(runId, root = defaultStateRoot()) {
  return readResources(runId, root)[0] || null;
}

function clearResource(runId, root, ownerToken, selector = {}) {
  const runDirectory = resolveRunDirectory(runId, root);
  return withRunLock(runDirectory, () => {
    const session = readJson(path.join(runDirectory, 'session.json'), 'Sandbox session');
    const state = readJson(path.join(runDirectory, 'state.json'), 'Sandbox state');
    if (ownerToken !== session.owner_token) throw new Error('Sandbox resource owner token does not match the session');
    const resources = readResources(runId, root);
    if (resources.some(resource => resource.owner_token !== ownerToken)) {
      throw new Error('Sandbox resource owner token does not match the session');
    }
    const matches = resource => (
      (!selector.kind || resource.kind === selector.kind)
      && (!selector.name || resource.name === selector.name)
      && (!selector.pid || resource.pid === selector.pid)
    );
    const retained = Object.keys(selector).length === 0 ? [] : resources.filter(resource => !matches(resource));
    const resourcePath = path.join(runDirectory, 'resource.json');
    if (retained.length === 0) fs.rmSync(resourcePath, { force: true });
    else writeJsonAtomic(resourcePath, { schema_version: 1, run_id: runId, resources: retained });
    writeStateUnlocked(runDirectory, runId, state, {
      resources: retained.map(item => ({ kind: item.kind, name: item.name || null })),
    });
    return resources.length !== retained.length;
  });
}

function listControls(runId, root = defaultStateRoot()) {
  const current = readRun(runId, root);
  return fs.readdirSync(path.join(current.run_directory, 'controls'))
    .filter(name => /^ctl_[a-f0-9]{24}\.json$/.test(name))
    .flatMap(name => {
      try {
        return [readJson(path.join(current.run_directory, 'controls', name), 'Sandbox control')];
      } catch (error) {
        if (error.code === 'ENOENT' || /unavailable.*ENOENT/.test(error.message)) return [];
        throw error;
      }
    })
    .filter(control => (
      CONTROL_ID_PATTERN.test(control.control_id)
      && control.run_id === runId
      && control.owner_token === current.session.owner_token
      && SUPPORTED_CONTROLS.has(control.action)
    ))
    .sort((left, right) => (
      (left.created_seq - right.created_seq)
      || left.control_id.localeCompare(right.control_id)
    ));
}

function consumeControl(runId, root, controlId) {
  if (!CONTROL_ID_PATTERN.test(String(controlId || ''))) throw new Error('Invalid sandbox control ID');
  const current = readRun(runId, root);
  const source = path.join(current.run_directory, 'controls', `${controlId}.json`);
  const destination = path.join(current.run_directory, 'responses', `${controlId}.consumed.json`);
  fs.renameSync(source, destination);
  fs.chmodSync(destination, 0o600);
}

function writeControlResponse(runId, root, controlId, response) {
  if (!CONTROL_ID_PATTERN.test(String(controlId || ''))) throw new Error('Invalid sandbox control ID');
  const current = readRun(runId, root);
  writeJsonAtomic(
    path.join(current.run_directory, 'responses', `${controlId}.json`),
    sanitizeValue({ schema_version: 1, control_id: controlId, run_id: runId, ...response })
  );
}

function readControlResponse(runId, root, controlId) {
  const current = readRun(runId, root);
  const responsePath = path.join(current.run_directory, 'responses', `${controlId}.json`);
  return fs.existsSync(responsePath) ? readJson(responsePath, 'Sandbox control response') : null;
}

function finalizeMetrics(input) {
  const wallMs = Math.max(0, Math.round(input.wall_ms || 0));
  const reviewWaitMs = Math.max(0, Math.round(input.review_wait_ms || 0));
  if (reviewWaitMs > wallMs) throw new Error('review_wait_ms cannot exceed wall_ms');
  return {
    schema_version: 1,
    wall_ms: wallMs,
    review_wait_ms: reviewWaitMs,
    active_total_ms: wallMs - reviewWaitMs,
    phases: { ...(input.phases || {}) },
    steps: [...(input.steps || [])],
    inspections: [...(input.inspections || [])],
  };
}

function sanitizeValue(value, key = '') {
  const normalizedKey = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (
    /(?:token|password|passwd|secret|apikey|authorization|cookie|privatekey|credential|accesskey|owner)$/.test(normalizedKey)
    || normalizedKey.includes('secretaccesskey')
  ) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') return redactText(value).text;
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitizeValue(item, name)]));
  }
  return value;
}

function writeReport(runId, root, report, metrics) {
  const current = readRun(runId, root);
  const safeReport = sanitizeValue(report);
  const safeMetrics = sanitizeValue(metrics);
  writeJsonAtomic(path.join(current.run_directory, 'report.json'), safeReport);
  writeJsonAtomic(path.join(current.run_directory, 'metrics.json'), safeMetrics);
  return { report: safeReport, metrics: safeMetrics };
}

function evaluateRun(runId, root = defaultStateRoot()) {
  const current = readRun(runId, root);
  const report = readJson(path.join(current.run_directory, 'report.json'), 'Sandbox report');
  const metrics = readJson(path.join(current.run_directory, 'metrics.json'), 'Sandbox metrics');
  const events = listEvents(runId, root);
  const cleanupEvent = [...events].reverse().find(event => event.type === 'cleanup.completed');
  const blockers = [];
  if (report.execution_mode !== 'real') blockers.push('execution was not real');
  if (report.result !== 'pass') blockers.push(`sandbox result is ${report.result}`);
  if (
    current.session.requested_report === 'install-diff'
    && report.install_diff?.complete !== true
  ) {
    blockers.push('installation evidence is incomplete');
  }
  if (current.state.status !== 'completed') {
    blockers.push(`run lifecycle is ${current.state.status}`);
  }
  if (!cleanupEvent || cleanupEvent.pass !== true) blockers.push('sandbox cleanup did not pass');
  if (readResources(runId, root).length > 0) blockers.push('owned sandbox resources remain registered');
  const failedStep = report.steps?.find(step => step.exit !== 0) || null;
  const redactions = events.reduce((total, event) => total + (event.redaction_count || 0), 0);
  const truncations = events.filter(event => event.truncated === true).length;
  const castPath = path.join(current.run_directory, 'review.cast');
  const videoPath = path.join(current.run_directory, 'review.mp4');
  return {
    schema_version: 1,
    run_id: runId,
    tier: current.session.route.tier,
    backend: current.session.route.backend,
    execution_mode: report.execution_mode,
    verdict: blockers.length === 0 ? 'pass' : 'inconclusive',
    result: report.result,
    blockers,
    first_failure: failedStep,
    evidence_complete: current.session.requested_report === 'install-diff'
      ? report.install_diff?.complete === true
      : true,
    cleanup: cleanupEvent ? { pass: cleanupEvent.pass === true } : { pass: null },
    artifacts: {
      recording: fs.existsSync(castPath) ? castPath : null,
      video: fs.existsSync(videoPath) ? videoPath : null,
    },
    redaction: {
      count: redactions,
      truncated_events: truncations,
      dropped_output_events: current.state.dropped_output_events || 0,
      dropped_output_bytes: current.state.dropped_output_bytes || 0,
    },
    trust_limits: report.notes?.filter(note => /trust|seed|bounded|best-effort|container evidence/i.test(note)) || [],
    performance: metrics,
  };
}

module.exports = {
  CONTROL_ID_PATTERN,
  RUN_ID_PATTERN,
  appendEvent,
  clearResource,
  consumeControl,
  createControl,
  createRun,
  defaultStateRoot,
  ensurePrivateDirectory,
  evaluateRun,
  finalizeMetrics,
  listControls,
  listEvents,
  readResource,
  readEventsSince,
  readResources,
  readControlResponse,
  readRun,
  redactText,
  sanitizeValue,
  resolveRunDirectory,
  transitionState,
  transitionStateWithEvent,
  updateState,
  validateRunId,
  validateStateRoot,
  writeControlResponse,
  writeJsonAtomic,
  writeResource,
  writeReport,
};
