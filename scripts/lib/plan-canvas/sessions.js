'use strict';

/**
 * Plan Canvas session store.
 *
 * Sessions are keyed by the canonical artifact file path so agents never
 * juggle opaque ids. State is persisted as JSON in the Plan Canvas state
 * dir so queued human feedback survives a server restart.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FEEDBACK_KINDS = new Set(['chat', 'annotation', 'verdict']);
const VERDICTS = new Set(['approve', 'request-changes']);

function resolveStateDir(env = process.env) {
  const override = env.ECC_PLAN_CANVAS_STATE_DIR;
  if (override && String(override).trim()) return path.resolve(String(override).trim());
  return path.join(os.homedir(), '.claude', 'plan-canvas');
}

// Canonicalize so `./plan.md`, symlinks, and absolute paths all land on the
// same session.
function canonicalizeArtifactPath(filePath) {
  const absolute = path.resolve(filePath);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function sessionKeyFor(canonicalPath) {
  return crypto.createHash('sha256').update(canonicalPath).digest('hex').slice(0, 12);
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeText(value, maxLength = 4000) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLength);
}

// Normalize one browser-submitted feedback item into the shape delivered to
// the agent. Returns null for unusable input rather than throwing so a
// malformed item can never wedge the queue.
function normalizeFeedbackItem(raw, counter) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = FEEDBACK_KINDS.has(raw.kind) ? raw.kind : null;
  if (!kind) return null;
  const item = {
    id: `fb-${counter}`,
    kind,
    text: sanitizeText(raw.text),
    at: nowIso()
  };
  if (kind === 'verdict') {
    if (!VERDICTS.has(raw.verdict)) return null;
    item.verdict = raw.verdict;
  }
  if (kind === 'annotation') {
    const anchor = raw.anchor && typeof raw.anchor === 'object' ? raw.anchor : null;
    if (!anchor || typeof anchor.selector !== 'string') return null;
    item.anchor = {
      selector: sanitizeText(anchor.selector, 500),
      tag: sanitizeText(anchor.tag, 60),
      snippet: sanitizeText(anchor.snippet, 400)
    };
    if (anchor.textRange && typeof anchor.textRange === 'object') {
      item.anchor.textRange = {
        text: sanitizeText(anchor.textRange.text, 1000)
      };
    }
    if (!item.text) return null;
  }
  if (kind === 'chat' && !item.text) return null;
  return item;
}

function createSessionStore({ stateDir = resolveStateDir() } = {}) {
  const stateFile = path.join(stateDir, 'sessions.json');
  let state = { sessions: {}, feedbackCounter: 0 };

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.sessions) {
        state = {
          sessions: parsed.sessions,
          feedbackCounter: Number(parsed.feedbackCounter) || 0
        };
      }
    } catch {
      // Missing or corrupt state starts fresh; queued feedback loss on a
      // corrupt file beats refusing to start at all.
    }
  }

  function persist() {
    fs.mkdirSync(stateDir, { recursive: true });
    const tmpFile = `${stateFile}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
    fs.renameSync(tmpFile, stateFile);
  }

  load();

  function get(key) {
    return state.sessions[key] || null;
  }

  function findByFile(filePath) {
    const canonical = canonicalizeArtifactPath(filePath);
    return get(sessionKeyFor(canonical));
  }

  // Open (or resume) a session. A session the *user* ended from the browser
  // is sticky: it refuses a plain reopen so agents do not pop the browser
  // back up uninvited. Pass reopen:true only when the human asked.
  function open(filePath, { reopen = false } = {}) {
    const canonical = canonicalizeArtifactPath(filePath);
    const key = sessionKeyFor(canonical);
    const existing = state.sessions[key];
    if (existing && existing.status === 'ended' && existing.endedBy === 'user' && !reopen) {
      return { session: existing, refused: true };
    }
    const session = existing || {
      key,
      file: canonical,
      chat: [],
      pendingFeedback: [],
      createdAt: nowIso()
    };
    session.status = 'open';
    delete session.endedBy;
    session.updatedAt = nowIso();
    state.sessions[key] = session;
    persist();
    return { session, refused: false };
  }

  // Queue feedback from the browser. Chat-shaped items are mirrored into the
  // session transcript immediately so the conversation panel stays coherent
  // across reloads.
  function queueFeedback(key, rawItems, { endSession = false } = {}) {
    const session = get(key);
    if (!session || session.status === 'ended') return null;
    const accepted = [];
    for (const raw of Array.isArray(rawItems) ? rawItems : []) {
      state.feedbackCounter += 1;
      const item = normalizeFeedbackItem(raw, state.feedbackCounter);
      if (item) accepted.push(item);
    }
    session.pendingFeedback.push(...accepted);
    for (const item of accepted) {
      session.chat.push({ role: 'user', kind: item.kind, text: chatLineFor(item), at: item.at });
    }
    if (endSession) {
      session.status = 'ended';
      session.endedBy = 'user';
    } else if (accepted.length > 0) {
      session.status = 'feedback';
    }
    session.updatedAt = nowIso();
    persist();
    return { accepted, pending: session.pendingFeedback.length, session };
  }

  // Deliver-and-drain: feedback is handed to exactly one await call, after
  // which the session flips back to open. An ended session keeps reporting
  // ended (with attribution) so agents know to stop polling.
  function takeFeedback(key) {
    const session = get(key);
    if (!session) return { status: 'missing' };
    if (session.pendingFeedback.length > 0) {
      const items = session.pendingFeedback;
      session.pendingFeedback = [];
      const result = { status: 'feedback', items };
      if (session.status === 'ended') {
        result.sessionEnded = true;
        result.endedBy = session.endedBy;
      } else {
        session.status = 'open';
      }
      session.updatedAt = nowIso();
      persist();
      return result;
    }
    if (session.status === 'ended') {
      return { status: 'ended', endedBy: session.endedBy };
    }
    return { status: 'waiting' };
  }

  function addAgentReply(key, text) {
    const session = get(key);
    if (!session) return null;
    const entry = { role: 'agent', kind: 'chat', text: sanitizeText(text), at: nowIso() };
    session.chat.push(entry);
    session.updatedAt = nowIso();
    persist();
    return entry;
  }

  function end(key, endedBy) {
    const session = get(key);
    if (!session) return null;
    session.status = 'ended';
    session.endedBy = endedBy === 'user' ? 'user' : 'agent';
    session.updatedAt = nowIso();
    persist();
    return session;
  }

  function list() {
    return Object.values(state.sessions).map(session => ({
      key: session.key,
      file: session.file,
      status: session.status,
      endedBy: session.endedBy,
      pending: session.pendingFeedback.length,
      updatedAt: session.updatedAt
    }));
  }

  function hasOpenSessions() {
    return Object.values(state.sessions).some(session => session.status !== 'ended');
  }

  return {
    stateDir,
    stateFile,
    open,
    get,
    findByFile,
    queueFeedback,
    takeFeedback,
    addAgentReply,
    end,
    list,
    hasOpenSessions
  };
}

// One-line rendering of a feedback item for the conversation transcript.
function chatLineFor(item) {
  if (item.kind === 'verdict') {
    const label = item.verdict === 'approve' ? 'Approved the plan' : 'Requested changes';
    return item.text ? `${label}: ${item.text}` : label;
  }
  if (item.kind === 'annotation') {
    const where = item.anchor.snippet || item.anchor.selector;
    return `[${where}] ${item.text}`;
  }
  return item.text;
}

module.exports = {
  canonicalizeArtifactPath,
  createSessionStore,
  normalizeFeedbackItem,
  resolveStateDir,
  sessionKeyFor
};
