'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const METRICS_SCHEMA_VERSION = 1;
const METRICS_FILE_NAME = 'metrics.jsonl';
const METRICS_MAX_BYTES = 1024 * 1024;
const SESSION_DIGEST_LENGTH = 12;
const CODE_MAX_LENGTH = 48;
const CODE_PATTERN = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?$/;
const SESSION_PATTERN = /^[0-9a-f]{12}$/;
const APPEND_FLAGS = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0);

const DECISIONS = Object.freeze([
  'deny',
  'credit',
  'sibling',
  'cap',
  'trivial',
  'pass-checked',
  'pass-exempt',
  'pass-subagent',
  'routine-deny',
  'routine-readonly',
  'destructive-deny',
  'pass'
]);
const DECISION_SET = new Set(DECISIONS);
const TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell']);

function isCode(value) {
  return typeof value === 'string' && value.length <= CODE_MAX_LENGTH && CODE_PATTERN.test(value);
}

function codeOrNull(value) {
  return isCode(value) ? value : null;
}

function sessionDigest(sessionKey) {
  return crypto.createHash('sha256').update(String(sessionKey || '')).digest('hex').slice(0, SESSION_DIGEST_LENGTH);
}

function profileFields(profile) {
  if (!profile || typeof profile !== 'object') return null;
  return {
    known: profile.known === true,
    language: codeOrNull(profile.language),
    touchesPublicSurface: profile.touchesPublicSurface === true,
    touchesData: profile.touchesData === true,
    trivial: profile.trivial === true
  };
}

/** One metrics line for a gate decision, or null when the decision or tool is not recorded. */
function metricsEvent({ sessionKey, tool, cls, decision, reason, questions, sensitive, profile, now = Date.now() }) {
  if (!DECISION_SET.has(decision) || !TOOLS.has(tool)) return null;
  return {
    v: METRICS_SCHEMA_VERSION,
    ts: new Date(now).toISOString(),
    session: sessionDigest(sessionKey),
    tool,
    class: codeOrNull(cls),
    decision,
    reason: codeOrNull(reason),
    questions: Array.isArray(questions) ? questions.filter(isCode) : null,
    sensitive: sensitive === true,
    profile: profileFields(profile)
  };
}

/** Whether a parsed line has the shape `metricsEvent` writes. */
function isMetricsEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.v !== METRICS_SCHEMA_VERSION || typeof value.ts !== 'string') return false;
  if (typeof value.session !== 'string' || !SESSION_PATTERN.test(value.session)) return false;
  if (!TOOLS.has(value.tool) || !DECISION_SET.has(value.decision)) return false;
  if (value.class !== null && !isCode(value.class)) return false;
  if (value.reason !== null && !isCode(value.reason)) return false;
  if (value.questions !== null && !(Array.isArray(value.questions) && value.questions.every(isCode))) return false;
  return typeof value.sensitive === 'boolean';
}

/** Append events to `<dir>/metrics.jsonl` in one write, rotating to `.1` past the size cap; never throws. */
function appendMetrics(dir, events) {
  let fd = null;
  try {
    const lines = events
      .filter(Boolean)
      .map(event => `${JSON.stringify(event)}\n`)
      .join('');
    if (!lines) return false;
    const file = path.join(dir, METRICS_FILE_NAME);
    fs.mkdirSync(dir, { recursive: true });
    let size = 0;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile()) return false;
      size = stat.size;
    } catch (_) {
      size = 0;
    }
    if (size > 0 && size + Buffer.byteLength(lines) > METRICS_MAX_BYTES) {
      fs.renameSync(file, `${file}.1`);
    }
    fd = fs.openSync(file, APPEND_FLAGS, 0o600);
    if (!fs.fstatSync(fd).isFile()) return false;
    fs.writeSync(fd, lines);
    return true;
  } catch (_) {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

module.exports = {
  DECISIONS,
  METRICS_FILE_NAME,
  METRICS_MAX_BYTES,
  METRICS_SCHEMA_VERSION,
  appendMetrics,
  isMetricsEvent,
  metricsEvent,
  sessionDigest
};
