'use strict';

// This API records explicit host facts and measured runtime metadata. It does
// not infer skill invocation from file reads, installed catalogs or prose.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { projectDirectory, readBounded } = require('./copilot-sessions');
const MAX_BYTES = 1024 * 1024;
const MAX_RECORDS = 2000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SKILL_KINDS = Object.freeze(['discovered', 'selected', 'invoked', 'completed', 'failed', 'unknown']);
const HOOK_STATES = Object.freeze(['success', 'failure', 'timeout', 'unavailable']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:@/-]{1,128}$/.test(value)) throw new Error('Invalid telemetry identifier.');
  return value;
}
function telemetryFile(workspace, env = process.env, create = false) {
  const directory = projectDirectory(fs.realpathSync(workspace), env, create);
  return directory ? path.join(directory, 'telemetry.jsonl') : null;
}
function validate(row) {
  const common = ['schema', 'timestamp', 'session', 'eventId', 'projectId', 'type'];
  const keys = row?.type === 'skill' ? [...common, 'skillId', 'kind', 'callId', 'source']
    : [...common, 'hookId', 'status', 'durationMs', 'source'];
  if (!row || Object.keys(row).some(key => !keys.includes(key))
    || typeof row.timestamp !== 'string' || row.schema !== 'ecc.copilot.telemetry.v1' || !Number.isFinite(Date.parse(row.timestamp))
    || !['skill', 'hook'].includes(row.type) || !/^[a-f0-9]{64}$/.test(row.session)
    || !/^[a-f0-9]{64}$/.test(row.eventId) || !/^[a-f0-9]{64}$/.test(row.projectId)) throw new Error('Invalid telemetry schema.');
  if (row.type === 'skill') {
    id(row.skillId);
    if (!SKILL_KINDS.includes(row.kind) || !/^[a-f0-9]{64}$/.test(row.callId)
      || row.source !== 'explicit-host-signal') throw new Error('Invalid skill telemetry.');
  } else {
    id(row.hookId);
    if (!HOOK_STATES.includes(row.status) || !Number.isFinite(row.durationMs) || row.durationMs < 0
      || row.source !== 'hook-runtime') throw new Error('Invalid hook telemetry.');
  }
  return row;
}
function readTelemetry(workspace, env = process.env) {
  const file = telemetryFile(workspace, env);
  if (!file) return [];
  try {
    const raw = readBounded(file, MAX_BYTES);
    if (raw && !raw.endsWith('\n')) throw new Error('Incomplete telemetry record.');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length > MAX_RECORDS) throw new Error('Telemetry quota exceeded.');
    const rows = lines.map(line => validate(JSON.parse(line)));
    if (rows.some(row => row.projectId !== hash(fs.realpathSync(workspace)))) throw new Error('Foreign telemetry project.');
    return rows;
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
function appendFact(fact, env, fields) {
  if (env.ECC_COPILOT_TELEMETRY !== '1') return { status: 'disabled' };
  const workspace = fs.realpathSync(fact.workspace);
  const row = validate({ schema: 'ecc.copilot.telemetry.v1', timestamp: new Date().toISOString(),
    session: hash(id(fact.sessionId)), eventId: hash(id(fact.eventId)), projectId: hash(workspace), ...fields });
  const file = telemetryFile(workspace, env, true);
  const lock = `${file}.lock`;
  fs.mkdirSync(lock, { mode: 0o700 });
  let temp;
  try {
    const now = Date.now();
    const rows = readTelemetry(workspace, env).filter(previous => now - Date.parse(previous.timestamp) <= RETENTION_MS);
    if (rows.some(previous => previous.session === row.session
      && (row.type === 'skill' ? previous.callId === row.callId : previous.eventId === row.eventId)
      && previous.type === row.type
      && (row.type === 'hook' ? previous.hookId === row.hookId
        : previous.skillId === row.skillId && previous.kind === row.kind))) return { status: 'duplicate' };
    const retained = [...rows, row].slice(-MAX_RECORDS);
    const raw = retained.map(previous => JSON.stringify(previous)).join('\n') + '\n';
    if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('Telemetry byte quota exceeded.');
    temp = `${file}.${crypto.randomUUID()}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, raw); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
    return { status: 'recorded' };
  } finally {
    if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
    fs.rmdirSync(lock);
  }
}
function recordSkillFact(fact, env = process.env) {
  if (env.ECC_COPILOT_TELEMETRY !== '1') return { status: 'disabled' };
  return appendFact(fact, env, { type: 'skill', skillId: id(fact.skillId), kind: fact.kind,
    callId: hash(id(fact.callId)), source: fact.source });
}
function recordHookMetric(fact, env = process.env) {
  if (env.ECC_COPILOT_TELEMETRY !== '1') return { status: 'disabled' };
  return appendFact(fact, env, { type: 'hook', hookId: id(fact.hookId),
    status: fact.status, durationMs: fact.durationMs, source: 'hook-runtime' });
}
function summarizeTelemetry(rows) {
  const skills = Object.create(null);
  const hooks = Object.create(null);
  for (const row of rows.map(validate)) {
    if (row.type === 'skill') {
      const previous = skills[row.skillId] || Object.fromEntries(SKILL_KINDS.map(kind => [kind, 0]));
      skills[row.skillId] = { ...previous, [row.kind]: previous[row.kind] + 1 };
    } else {
      const previous = hooks[row.hookId] || { count: 0, durations: [], states: {} };
      hooks[row.hookId] = { count: previous.count + 1, durations: [...previous.durations, row.durationMs],
        states: { ...previous.states, [row.status]: (previous.states[row.status] || 0) + 1 } };
    }
  }
  const metrics = Object.fromEntries(Object.entries(hooks).map(([key, value]) => {
    const durations = [...value.durations].sort((a,b) => a-b);
    return [key, { count: value.count, states: value.states,
      p50Ms: durations[Math.ceil(durations.length * 0.5) - 1], p95Ms: durations[Math.ceil(durations.length * 0.95) - 1] }];
  }));
  return { skills, hooks: metrics, tokens: null, costUsd: null, contextUsage: { status: 'unavailable' } };
}
function skillHealthRecords(rows) {
  // Reuse canonical record normalization, but never feed unknown outcomes into
  // its success/failure rate denominator. No second append-only sink is needed.
  const { normalizeExecutionRecord } = require('./skill-evolution/tracker');
  const terminal = rows.map(validate).filter(row => row.type === 'skill' && ['completed', 'failed'].includes(row.kind));
  const unique = new Map();
  for (const row of terminal) {
    const key = `${row.projectId}:${row.session}:${row.skillId}:${row.callId}`;
    const previous = unique.get(key);
    // Contradictory terminal events stay unmeasured, regardless of order.
    unique.set(key, previous && previous.kind !== row.kind ? { ...row, kind: 'unknown' } : row);
  }
  return [...unique.values()].filter(row => row.kind !== 'unknown').map(row => normalizeExecutionRecord({
    skill_id: row.skillId, skill_version: 'unknown', task_description: `Observed skill: ${row.skillId}`,
    outcome: row.kind === 'completed' ? 'success' : 'failure', recorded_at: row.timestamp,
    tokens_used: null, duration_ms: null,
  }));
}
module.exports = { recordSkillFact, recordHookMetric, readTelemetry, summarizeTelemetry,
  skillHealthRecords, telemetryFile, MAX_BYTES, MAX_RECORDS, SKILL_KINDS };
