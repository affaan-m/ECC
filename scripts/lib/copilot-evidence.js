'use strict';

// Narrow Copilot equivalent: observed unchanged Read-before-edit. It records
// facts, never operator permission or Claude transcript-derived authorization.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseEventEnvelope } = require('./copilot-event-envelope');
const { projectDirectory, readBounded, sessionId } = require('./copilot-sessions');
const { classifyTargetFor } = require('./gateguard-target-class');
const { isHookEnabled } = require('./hook-flags');
const TTL_MS = 10 * 60 * 1000;
const MAX_STATE = 64 * 1024;
const MAX_TARGETS = 64;
const SCHEMA = 'ecc.copilot.read-evidence.v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));

function stateFile(workspace, id, env = process.env, create = false) {
  const root = projectDirectory(fs.realpathSync(workspace), env, create);
  if (!root) return null;
  let current = root;
  for (const segment of ['read-evidence', hash(sessionId(id))]) {
    current = path.join(current, segment);
    try { fs.lstatSync(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) return null;
      try { fs.mkdirSync(current, { mode: 0o700 }); }
      catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
    }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe evidence directory.');
  }
  return path.join(current, 'state.json');
}
function blank(workspace, id) {
  return { schema: SCHEMA, workspace: hash(workspace), session: hash(id), boundary: 0,
    active: false, turn: null, pending: [], proofs: [] };
}
function validSnapshot(value) {
  return exact(value, ['digest', 'dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'])
    && /^[a-f0-9]{64}$/.test(value.digest)
    && ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => Number.isFinite(value[key]) && value[key] >= 0);
}
function load(file, workspace, id) {
  try {
    const state = JSON.parse(readBounded(file, MAX_STATE));
    if (!exact(state, ['schema', 'workspace', 'session', 'boundary', 'active', 'turn', 'pending', 'proofs'])
      || state.schema !== SCHEMA || state.workspace !== hash(workspace) || state.session !== hash(id)
      || !Number.isSafeInteger(state.boundary) || state.boundary < 0 || typeof state.active !== 'boolean'
      || (state.turn !== null && (typeof state.turn !== 'string' || !/^[a-f0-9]{64}$/.test(state.turn)))
      || !['pending', 'proofs'].every(key => Array.isArray(state[key]) && state[key].length <= MAX_TARGETS
        && state[key].every(item => exact(item, ['target', 'snapshot', 'at', 'call', 'turn'])
          && /^[a-f0-9]{64}$/.test(item.target) && validSnapshot(item.snapshot)
          && Number.isSafeInteger(item.at) && item.at > state.boundary
          && (item.call === null || /^[a-f0-9]{64}$/.test(item.call))
          && (item.turn === null || /^[a-f0-9]{64}$/.test(item.turn))))) throw new Error('Invalid evidence state.');
    return state;
  } catch (error) { if (error.code === 'ENOENT') return blank(workspace, id); throw error; }
}
function update(workspace, id, env, transform) {
  const file = stateFile(workspace, id, env, true);
  const lock = `${file}.lock`; fs.mkdirSync(lock, { mode: 0o700 });
  let temporary;
  try {
    const next = transform(load(file, workspace, id));
    const raw = JSON.stringify(next);
    if (Buffer.byteLength(raw) > MAX_STATE) throw new Error('Evidence quota exceeded.');
    temporary = `${file}.${crypto.randomUUID()}.tmp`;
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, raw); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
    return next;
  } finally {
    if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
    fs.rmdirSync(lock);
  }
}
function targetFor(workspace, value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error('Invalid evidence target.');
  const target = path.resolve(workspace, value);
  const relative = path.relative(workspace, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Foreign evidence target.');
  let ancestor = target;
  while (!fs.existsSync(ancestor) && ancestor !== path.dirname(ancestor)) {
    try { if (fs.lstatSync(ancestor).isSymbolicLink()) throw new Error('Linked evidence target.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    ancestor = path.dirname(ancestor);
  }
  if (fs.realpathSync(ancestor) !== ancestor) throw new Error('Linked evidence target.');
  return target;
}
function snapshot(file) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error('Unsafe evidence target.');
  const digest = hash(readBounded(file, 1024 * 1024));
  const after = fs.lstatSync(file);
  const keys = ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'];
  if (keys.some(key => before[key] !== after[key]) || after.nlink !== 1) throw new Error('Evidence target changed while reading.');
  return { digest, ...Object.fromEntries(keys.map(key => [key, after[key]])) };
}
function same(a, b) { return Object.keys(a).every(key => a[key] === b[key]); }
function visibleSource(payload, target) {
  const result = payload.toolResult ?? payload.tool_result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  const camel = Object.hasOwn(result, 'textResultForLlm');
  const snake = Object.hasOwn(result, 'text_result_for_llm');
  if (camel && snake && result.textResultForLlm !== result.text_result_for_llm) return false;
  const text = camel ? result.textResultForLlm : result.text_result_for_llm;
  // Success alone does not prove that automatic view truncation exposed the
  // whole source. Unknown decorated formats remain unsupported, not guessed.
  return typeof text === 'string' && Buffer.byteLength(text) <= 1024 * 1024
    && text.includes(readBounded(target, 1024 * 1024));
}
function timestamp(payload, now) {
  const value = payload.timestamp;
  const at = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) ? Date.parse(value) : value;
  if (!Number.isSafeInteger(at) || at < 0 || at > now + 5000) throw new Error('Missing or invalid native event timestamp.');
  return at;
}
function handleEvent(event, payload, env = process.env, options = {}) {
  if (env.ECC_COPILOT_FACTFORCE !== '1') return { status: 'disabled' };
  const envelope = parseEventEnvelope(event, payload);
  const workspace = envelope.workspace.canonical;
  const id = sessionId(envelope.sessionId);
  const now = options.now ?? Date.now(); const at = timestamp(payload, now);
  const turn = envelope.turnId ? hash(envelope.turnId) : null;
  if (['sessionStart', 'userPromptSubmitted', 'agentStop', 'preCompact', 'sessionEnd'].includes(event)) {
    const opening = ['sessionStart', 'userPromptSubmitted', 'preCompact'].includes(event);
    update(workspace, id, env, previous => at < previous.boundary || (opening && at === previous.boundary) ? previous : {
      ...blank(workspace, id), boundary: at, turn,
      active: opening,
    });
    return { status: 'boundary' };
  }
  if (!['preToolUse', 'postToolUse', 'postToolUseFailure'].includes(event) || envelope.tool?.name !== 'Read') return { status: 'ignored' };
  const args = envelope.tool.args;
  if (['view_range', 'start_line', 'end_line', 'offset', 'limit'].some(key => args[key] !== undefined)) return { status: 'partial-read' };
  const target = targetFor(workspace, args.file_path);
  const fingerprint = snapshot(target);
  const targetId = hash(target); const call = envelope.callId ? hash(envelope.callId) : null;
  const complete = event === 'postToolUse' && envelope.outcome.status === 'succeeded' && visibleSource(payload, target);
  update(workspace, id, env, previous => {
    if (!previous.active || at <= previous.boundary || (previous.turn && previous.turn !== turn)) return previous;
    const pending = previous.pending.filter(item => item.target !== targetId);
    const proofs = previous.proofs.filter(item => item.target !== targetId);
    if (event === 'preToolUse') {
      if (pending.length >= MAX_TARGETS) throw new Error('Evidence target quota exceeded.');
      return { ...previous, proofs, pending: [...pending, { target: targetId, snapshot: fingerprint, at, call, turn }] };
    }
    const started = previous.pending.find(item => item.target === targetId && item.call === call);
    if (!started && envelope.outcome.status === 'succeeded') return previous;
    const proved = started && started.turn === turn && at > started.at && now - started.at <= TTL_MS
      && complete && same(started.snapshot, fingerprint);
    if (proved && proofs.length >= MAX_TARGETS) throw new Error('Evidence proof quota exceeded.');
    return { ...previous, pending, proofs: proved ? [...proofs, { target: targetId, snapshot: fingerprint, at, call, turn }] : proofs };
  });
  return { status: event === 'postToolUse' && envelope.outcome.status === 'succeeded' && !complete ? 'incomplete-output' : 'observed' };
}
function checkEvidence(input, env = process.env, options = {}) {
  if (env.ECC_COPILOT_FACTFORCE !== '1') return { allowed: true, reason: 'disabled' };
  if (!input || !['Edit', 'Write'].includes(input.tool_name)) return { allowed: true, reason: 'not-applicable' };
  for (const [native, legacy] of [['sessionId', 'session_id'], ['turnId', 'turn_id']]) {
    if (input[native] !== undefined && input[legacy] !== undefined && input[native] !== input[legacy]) throw new Error('Conflicting evidence identity.');
  }
  const workspace = fs.realpathSync(input.cwd); const id = sessionId(input.session_id ?? input.sessionId);
  const args = input.tool_input;
  if (!args || (args.edits !== undefined && !Array.isArray(args.edits))) throw new Error('Invalid evidence edit targets.');
  const files = [...new Set([args.file_path, ...(args.edits || []).map(item => item.file_path || args.file_path)].filter(Boolean))];
  if (!files.length || files.length > MAX_TARGETS) throw new Error('Missing or excessive evidence edit targets.');
  const file = stateFile(workspace, id, env); const state = file ? load(file, workspace, id) : blank(workspace, id);
  const now = options.now ?? Date.now();
  const captureEnabled = isHookEnabled('copilot:read-evidence', {
    env: Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('CLAUDE_'))),
    profiles: ['standard', 'strict'],
  });
  for (const candidate of files) {
    const target = targetFor(workspace, candidate);
    if (!fs.existsSync(target) || classifyTargetFor(target, input) !== 'code') continue;
    const current = snapshot(target);
    const proof = state.proofs.find(item => item.target === hash(target));
    const turn = input.turnId ?? input.turn_id;
    if (!captureEnabled || !state.active || !proof || now < proof.at || now - proof.at > TTL_MS
      || proof.turn !== (turn ? hash(turn) : null)
      || (state.turn && state.turn !== (turn ? hash(turn) : null)) || !same(proof.snapshot, current)) {
      return { allowed: false, reason: 'Read the unchanged existing code file successfully in this session after the latest observed lifecycle boundary before editing it.' };
    }
  }
  return { allowed: true, reason: 'observed-read' };
}
module.exports = { handleEvent, checkEvidence, stateFile, TTL_MS };
