'use strict';

// Metadata-only learning observations. Checkpoints and active instincts are
// different stores; raw commands, arguments, output and reasoning never enter.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { projectDirectory, readBounded } = require('./copilot-sessions');
const MAX_BYTES = 1024 * 1024;
const MAX_RECORDS = 2000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const KNOWN_TOOLS = new Set(['Bash', 'PowerShell', 'Read', 'Write', 'Edit', 'Grep', 'Glob']);
const OUTCOMES = new Set(['succeeded', 'failed', 'unknown', 'not-run']);
const RECORD_KEYS = new Set(['schema', 'timestamp', 'event', 'tool', 'session', 'project_id', 'tool_use_id', 'outcome']);

function observationFile(workspace, env, create = false) {
  const directory = projectDirectory(fs.realpathSync(workspace), env, create);
  return directory ? path.join(directory, 'observations.jsonl') : null;
}

function validate(record, projectId) {
  if (!record || record.schema !== 'ecc.copilot.observation.v1'
    || Object.keys(record).some(key => !RECORD_KEYS.has(key))
    || !['tool_start', 'tool_complete'].includes(record.event)
    || !OUTCOMES.has(record.outcome) || !['unknown', ...KNOWN_TOOLS].includes(record.tool)
    || !/^[a-f0-9]{64}$/.test(record.project_id) || !/^[a-f0-9]{64}$/.test(record.session)
    || (record.tool_use_id !== null && !/^[a-f0-9]{64}$/.test(record.tool_use_id))
    || (projectId !== undefined && record.project_id !== projectId)
    || typeof record.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.timestamp)
    || !Number.isFinite(Date.parse(record.timestamp))) throw new Error('Invalid observation schema.');
  return record;
}

function readObservations(workspace, env = process.env) {
  const file = observationFile(workspace, env);
  if (!file) return [];
  try {
    const raw = readBounded(file, MAX_BYTES);
    if (raw && !raw.endsWith('\n')) throw new Error('Incomplete observation record.');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length > MAX_RECORDS) throw new Error('Observation quota exceeded.');
    const projectId = digest(fs.realpathSync(workspace));
    return lines.map(line => validate(JSON.parse(line), projectId));
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function observe(envelope, env = process.env) {
  if (env.ECC_COPILOT_OBSERVE !== '1') return { status: 'disabled' };
  if (!envelope || envelope.schemaVersion !== 1) throw new Error('Unknown observation envelope.');
  if (!['preToolUse', 'postToolUse', 'postToolUseFailure'].includes(envelope.event) || !envelope.sessionId) return { status: 'unavailable' };
  const workspace = fs.realpathSync(envelope.workspace.canonical);
  const file = observationFile(workspace, env, true);
  const lock = `${file}.lock`;
  fs.mkdirSync(lock, { mode: 0o700 });
  let temporary;
  try {
    const now = Date.now();
    const rows = readObservations(workspace, env).filter(row => now - Date.parse(row.timestamp) <= RETENTION_MS);
    const record = validate({ schema: 'ecc.copilot.observation.v1', timestamp: new Date(now).toISOString(),
      event: envelope.event === 'preToolUse' ? 'tool_start' : 'tool_complete',
      tool: KNOWN_TOOLS.has(envelope.tool?.name) ? envelope.tool.name : 'unknown',
      session: digest(envelope.sessionId), project_id: digest(workspace),
      tool_use_id: envelope.callId ? digest(envelope.callId) : null, outcome: envelope.outcome.status });
    const previous = record.tool_use_id && rows.find(row => row.session === record.session && row.event === record.event
      && row.tool_use_id === record.tool_use_id);
    if (previous && (previous.outcome === record.outcome || previous.outcome === 'unknown')) return { status: 'duplicate' };
    const retained = (previous
      ? rows.map(row => row === previous ? { ...row, outcome: 'unknown' } : row)
      : [...rows, record]).slice(-MAX_RECORDS);
    const raw = retained.map(row => JSON.stringify(row)).join('\n') + '\n';
    if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('Observation byte quota exceeded.');
    temporary = `${file}.${crypto.randomUUID()}.tmp`;
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, raw); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
    return { status: previous ? 'conflict' : 'recorded', projectId: record.project_id };
  } finally {
    if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
    fs.rmdirSync(lock);
  }
}

module.exports = { observe, readObservations, observationFile, MAX_BYTES, MAX_RECORDS };
