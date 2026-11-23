'use strict';

/**
 * Capsule recording for harness hook events.
 *
 * Maps SessionStart, PostToolUse and SessionEnd payloads to capsule-envelope/v1
 * records and appends them to one capsule per session. Tool arguments and
 * responses are reduced to sha256 digests before they reach the envelope's
 * default-deny allowlist and secret canary scan. Used by
 * scripts/hooks/capsule-recorder.js; the hook owns opt-in and error reporting.
 */

const fs = require('fs');
const path = require('path');
const { APPEND_LOCK_FILE, Capsule, CapsuleError, META_FILE, JOURNAL_FILE } = require('./eval-harness/capsule');
const { hashValue } = require('./eval-harness/canonical');
const { ID_PATTERN } = require('./eval-harness/envelope');
const { getClaudeDir } = require('./utils');

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TASK_FAMILY = 'session';
const BUSY_RETRIES = 20;
const BUSY_WAIT_MS = 25;
const WORD_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

// Effect classes are declarations (docs/architecture/eval-harness-frameworks.md).
// A hook sees the tool name, not what a command did, so anything outside these
// two lists is declared at the SE4 upper bound and replay will refuse it.
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'TodoRead']);
const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const FILE_PATH_KEYS = ['file_path', 'notebook_path'];

const EVENTS = Object.freeze({
  SessionStart: { lineage: 'environment', kind: 'session.start' },
  PostToolUse: { lineage: 'interaction', kind: 'tool.call' },
  SessionEnd: { lineage: 'environment', kind: 'session.end' },
});

function harnessVersion() {
  try {
    return String(require('../../package.json').version || 'unknown');
  } catch {
    return 'unknown';
  }
}

function isRecordingEnabled(env) {
  return ENABLED_VALUES.has(String(env.ECC_CAPSULE_RECORDING || '').trim().toLowerCase());
}

function resolveMaxBytes(env) {
  const parsed = Number(env.ECC_CAPSULE_MAX_BYTES);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES;
}

function resolveTaskFamily(env) {
  const family = String(env.ECC_CAPSULE_TASK_FAMILY || '').trim();
  return ID_PATTERN.test(family) ? family : DEFAULT_TASK_FAMILY;
}

function resolveCapsuleRoot(env) {
  const configured = String(env.ECC_CAPSULE_DIR || '').trim();
  return configured ? path.resolve(configured) : path.join(getClaudeDir(), 'capsules');
}

/** Session ids become run_id, capsule_id and a directory name, so they must be plain ids. */
function resolveSessionId(input) {
  const id = typeof input.session_id === 'string' ? input.session_id : '';
  return ID_PATTERN.test(id) ? id : null;
}

function isDanglingLink(target) {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Resolve symbolic links in the longest existing prefix of an absolute path.
 * Returns null when that prefix cannot be checked (a dangling link, a
 * permission error), so the caller declares the SE4 upper bound.
 */
function realpathOrNull(target) {
  const missing = [];
  for (let current = target; ;) {
    try {
      return path.join(fs.realpathSync(current), ...missing);
    } catch (error) {
      const parent = path.dirname(current);
      if (error.code !== 'ENOENT' || isDanglingLink(current) || parent === current) return null;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isInside(root, candidate) {
  const realRoot = realpathOrNull(path.resolve(root));
  const realTarget = realpathOrNull(path.resolve(root, candidate));
  if (!realRoot || !realTarget) return false;
  const relative = path.relative(realRoot, realTarget);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Every path an edit tool names: top-level keys plus MultiEdit-style edits[].file_path. */
function editTargets(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  const edits = Array.isArray(toolInput.edits) ? toolInput.edits : [];
  return [
    ...FILE_PATH_KEYS.map(key => toolInput[key]),
    ...edits.map(edit => (edit && typeof edit === 'object' ? edit.file_path : undefined)),
  ].filter(value => typeof value === 'string' && value.length > 0);
}

function classifyEffect(toolName, toolInput, cwd) {
  if (READ_ONLY_TOOLS.has(toolName)) return 'SE0';
  if (!FILE_EDIT_TOOLS.has(toolName)) return 'SE4';
  const paths = editTargets(toolInput);
  return paths.length > 0 && paths.every(value => isInside(cwd, value)) ? 'SE1' : 'SE4';
}

function wordOrNull(value) {
  return typeof value === 'string' && WORD_PATTERN.test(value) ? value : null;
}

function toolCallPayload(input) {
  const toolName = typeof input.tool_name === 'string' ? input.tool_name : '';
  const response = input.tool_response === undefined ? input.tool_output : input.tool_response;
  const callId = typeof input.tool_use_id === 'string' && ID_PATTERN.test(input.tool_use_id)
    ? { tool_call_id: input.tool_use_id }
    : {};
  return {
    tool: toolName,
    ...callId,
    args_hash: hashValue(input.tool_input === undefined ? null : input.tool_input),
    response_hash: hashValue(response === undefined ? null : response),
    status: 'ok',
  };
}

/** Build the { lineage, kind, payload, effect_class } record for one hook event, or null. */
function buildRecord(input, cwd) {
  const event = EVENTS[input.hook_event_name];
  if (!event) return null;
  if (input.hook_event_name === 'PostToolUse') {
    if (typeof input.tool_name !== 'string' || input.tool_name.length === 0) return null;
    return {
      ...event,
      payload: toolCallPayload(input),
      effect_class: classifyEffect(input.tool_name, input.tool_input, cwd),
    };
  }
  const word = wordOrNull(input.hook_event_name === 'SessionStart' ? input.source : input.reason);
  const key = input.hook_event_name === 'SessionStart' ? 'note' : 'reason';
  return { ...event, payload: word ? { [key]: word } : {}, effect_class: 'SE0' };
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Capsule.open reads without the append lock, so it can see a sibling's entry
 * mid-write as a truncated tail. Retry while that sibling still holds the lock;
 * a tail that is still truncated once the lock is gone is real damage.
 */
function openSettled(dir) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return Capsule.open(dir);
    } catch (error) {
      const appendInFlight = error instanceof CapsuleError && error.code === 'capsule.truncated_tail'
        && fs.existsSync(path.join(dir, APPEND_LOCK_FILE));
      if (!appendInFlight || attempt >= BUSY_RETRIES) throw error;
      sleep(BUSY_WAIT_MS);
    }
  }
}

/**
 * Create the capsule in a sibling staging directory and rename it into place,
 * so two first events of one session cannot interleave metadata writes.
 */
function openOrCreateCapsule(dir, meta) {
  if (fs.existsSync(path.join(dir, META_FILE))) return openSettled(dir);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(dir), `.${path.basename(dir)}-`));
  try {
    Capsule.create(staging, meta);
    fs.renameSync(staging, dir);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (!fs.existsSync(path.join(dir, META_FILE))) throw error;
  }
  return openSettled(dir);
}

function capDiagnostic(dir, maxBytes) {
  return journalBytes(dir) >= maxBytes
    ? `[CapsuleRecorder] skipped: journal reached ECC_CAPSULE_MAX_BYTES (${maxBytes})`
    : '';
}

/**
 * The capsule lock fails fast by design; a sibling hook holding it is normal, so
 * wait briefly. The cap is checked again before each attempt, because a sibling
 * that held the lock may have crossed it. Returns a skip diagnostic or ''.
 */
function appendWithRetry(capsule, record, dir, maxBytes) {
  for (let attempt = 0; ; attempt += 1) {
    const capped = capDiagnostic(dir, maxBytes);
    if (capped) return capped;
    try {
      capsule.append(record.lineage, record.kind, record.payload, { effect_class: record.effect_class });
      return '';
    } catch (error) {
      if (!(error instanceof CapsuleError) || error.code !== 'capsule.busy' || attempt >= BUSY_RETRIES) throw error;
      sleep(BUSY_WAIT_MS);
    }
  }
}

function journalBytes(dir) {
  try {
    return fs.statSync(path.join(dir, JOURNAL_FILE)).size;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

/** Append the record for one hook event. Returns a skip diagnostic, or '' when recorded or not applicable. */
function recordEvent(input, env, cwd) {
  const entry = buildRecord(input, cwd);
  if (!entry) return '';
  const sessionId = resolveSessionId(input);
  if (!sessionId) return '[CapsuleRecorder] skipped: session_id is missing or not a capsule id';
  const dir = path.join(resolveCapsuleRoot(env), sessionId);
  const maxBytes = resolveMaxBytes(env);
  const capped = capDiagnostic(dir, maxBytes);
  if (capped) return capped;
  const capsule = openOrCreateCapsule(dir, {
    run_id: sessionId,
    capsule_id: sessionId,
    harness_version: harnessVersion(),
    task_family: resolveTaskFamily(env),
  });
  return appendWithRetry(capsule, entry, dir, maxBytes);
}

module.exports = {
  DEFAULT_MAX_BYTES,
  buildRecord,
  classifyEffect,
  isRecordingEnabled,
  openOrCreateCapsule,
  recordEvent,
  resolveCapsuleRoot,
};
