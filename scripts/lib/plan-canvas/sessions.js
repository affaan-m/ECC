'use strict';

/**
 * Plan Canvas session store.
 *
 * Sessions are keyed by the canonical artifact file path so agents never
 * juggle opaque ids. State is persisted as JSON in the Plan Canvas state
 * dir so queued human feedback survives a server restart.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { normalizeUiFeedbackItem, uiChatLineFor } = require('../ui-canvas/feedback');
const { sanitizeAgentDescriptor } = require('./agent-identity');
const { sessionKeyFor } = require('./session-key');

const FEEDBACK_KINDS = new Set(['chat', 'annotation', 'verdict']);
const VERDICTS = new Set(['approve', 'request-changes']);
// A session renders either as a Plan Canvas review (markdown or HTML with the
// annotation layer) or as a UI Canvas editing surface (HTML mockup with the
// in-page editor). Both share one server, one state file, and one queue.
const SESSION_MODES = new Set(['plan', 'ui']);

// The producer and the SessionStart/Stop hooks must land on one directory. The
// hooks resolve CLAUDE_CONFIG_DIR (they cannot require this file: managed
// installs ship scripts/ without scripts/lib/, see #3259), so writing to
// ~/.claude here regardless would hide queued feedback from them whenever a
// session runs under a second profile.
function resolveClaudeConfigDir(env = process.env) {
  const configured = env.CLAUDE_CONFIG_DIR;
  const trimmed = configured ? String(configured).trim() : '';
  if (!trimmed) return path.join(os.homedir(), '.claude');
  if (trimmed.startsWith('~')) {
    const remainder = trimmed.slice(1).replace(/^[/\\]+/, '');
    return remainder ? path.join(os.homedir(), remainder) : os.homedir();
  }
  return path.resolve(trimmed);
}

function resolveStateDir(env = process.env) {
  const override = env.ECC_PLAN_CANVAS_STATE_DIR;
  if (override && String(override).trim()) return path.resolve(String(override).trim());
  return path.join(resolveClaudeConfigDir(env), 'plan-canvas');
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

  function persist(candidate = state) {
    fs.mkdirSync(stateDir, { recursive: true });
    const tmpFile = `${stateFile}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(candidate, null, 2));
    fs.renameSync(tmpFile, stateFile);
  }

  load();

  // Publish replacement state only after its complete snapshot is durable.
  // Retained session references remain snapshots, including on failed writes.
  function commitSession(key, session, feedbackCounter = state.feedbackCounter) {
    const candidate = { ...state, sessions: { ...state.sessions, [key]: session }, feedbackCounter };
    persist(candidate);
    state = candidate;
    return session;
  }

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
  function open(filePath, { reopen = false, mode = 'plan', ui = null } = {}) {
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
    session.mode = SESSION_MODES.has(mode) ? mode : 'plan';
    if (session.mode === 'ui') {
      session.ui = sanitizeUiOptions(ui, existing && existing.ui);
    } else {
      delete session.ui;
    }
    session.status = 'open';
    delete session.endedBy;
    session.updatedAt = nowIso();
    state.sessions[key] = session;
    persist();
    return { session, refused: false };
  }

  // Record which agent process is (or was last) listening on a session so the
  // browser can name it. Kept in state so a reconnecting browser sees it too.
  function setAgent(key, descriptor) {
    const session = get(key);
    if (!session) return null;
    const agent = sanitizeAgentDescriptor(descriptor);
    if (!agent) return session.agent || null;
    agent.seenAt = nowIso();
    session.agent = agent;
    persist();
    return agent;
  }

  // Queue feedback from the browser. Chat-shaped items are mirrored into the
  // session transcript immediately so the conversation panel stays coherent
  // across reloads.
  function queueFeedback(key, rawItems, { endSession = false, deliveryId = null, fingerprint = null } = {}) {
    const session = get(key);
    if (!session || session.status === 'ended') return null;
    const normalize = session.mode === 'ui' ? normalizeUiFeedbackItem : normalizeFeedbackItem;
    const describe = session.mode === 'ui' ? uiChatLineFor : chatLineFor;
    let counter = state.feedbackCounter;
    const accepted = [];
    for (const raw of Array.isArray(rawItems) ? rawItems : []) {
      counter += 1;
      const item = normalize(raw, counter);
      if (item) accepted.push(item);
    }
    const item = accepted[0];
    const next = {
      ...session,
      pendingFeedback: [...session.pendingFeedback, ...accepted],
      ...(session.mode === 'ui' ? { uiBatches: [...(session.uiBatches || []), ...accepted.filter(entry => entry.kind === 'edits').map(entry => ({
        id: entry.id, snapshotHash: entry.snapshotHash, includedBatches: entry.includedBatches || [], edits: entry.edits.filter(edit => !edit.stale)
      }))] } : {}),
      chat: [...session.chat, ...accepted.map(entry => ({ role: 'user', kind: entry.kind, text: describe(entry), at: entry.at }))],
      status: endSession ? 'ended' : accepted.length ? 'feedback' : session.status,
      ...(endSession ? { endedBy: 'user' } : {}),
      ...(deliveryId ? { uiDeliveries: { ...(session.uiDeliveries || {}), [deliveryId]: {
        fingerprint, kind: item.kind, itemIds: accepted.map(entry => entry.id),
        editIds: item.edits.filter(edit => !edit.stale).map(edit => edit.id), text: item.text
      } } } : {}),
      updatedAt: nowIso()
    };
    commitSession(key, next, counter);
    return { accepted, pending: next.pendingFeedback.length, session: next };
  }

  // Acknowledgment is distinct from delivery: taking feedback is not proof
  // that the agent has incorporated it into the artifact.
  function acknowledgeUiBatches(key, ids, replyText) {
    const session = get(key);
    if (!session || session.mode !== 'ui') return null;
    const known = [...(session.uiBatches || []), ...(session.uiAcknowledged || [])];
    if (ids.some(id => !known.some(batch => batch.id === id))) return null;
    const accepted = (session.uiBatches || []).filter(batch => ids.includes(batch.id));
    const entry = replyText ? { role: 'agent', kind: 'chat', text: sanitizeText(replyText), at: nowIso() } : null;
    commitSession(key, {
      ...session,
      uiBatches: (session.uiBatches || []).filter(batch => !ids.includes(batch.id)),
      uiAcknowledged: [...(session.uiAcknowledged || []), ...accepted.map(batch => ({ id: batch.id, editIds: batch.edits.map(edit => edit.id) }))],
      chat: entry ? [...session.chat, entry] : session.chat,
      updatedAt: nowIso()
    });
    return { batches: accepted.map(batch => ({ id: batch.id, editIds: batch.edits.map(edit => edit.id) })), entry };
  }

  // Deliver-and-drain: feedback is handed to exactly one await call, after
  // which the session flips back to open. An ended session keeps reporting
  // ended (with attribution) so agents know to stop polling.
  function takeFeedback(key, limits) {
    const session = get(key);
    if (!session || (limits?.createdAt && session.createdAt !== limits.createdAt)
      || (limits?.mode && (session.mode ?? 'plan') !== limits.mode)) return { status: 'missing' };
    if (session.pendingFeedback.length > 0) {
      const pending = session.pendingFeedback;
      const items = limits ? pending.slice(0, limits.items) : pending;
      const result = { status: 'feedback', items };
      while (items.length > 0) {
        if (session.status === 'ended' && items.length === pending.length) {
          result.sessionEnded = true;
          result.endedBy = session.endedBy;
        }
        if (!limits || Buffer.byteLength(JSON.stringify(result)) <= limits.bytes) break;
        items.pop();
        delete result.sessionEnded;
        delete result.endedBy;
      }
      if (!items.length) return { status: 'unavailable' };
      const pendingFeedback = pending.slice(items.length);
      const status = session.status === 'ended' || pendingFeedback.length ? session.status : 'open';
      commitSession(key, { ...session, pendingFeedback, status, updatedAt: nowIso() });
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
    commitSession(key, { ...session, chat: [...session.chat, entry], updatedAt: nowIso() });
    return entry;
  }

  function end(key, endedBy) {
    const session = get(key);
    if (!session) return null;
    return commitSession(key, { ...session, status: 'ended',
      endedBy: endedBy === 'user' ? 'user' : 'agent', updatedAt: nowIso() });
  }

  function list() {
    return Object.values(state.sessions).map(session => ({
      key: session.key,
      file: session.file,
      mode: session.mode || 'plan',
      status: session.status,
      endedBy: session.endedBy,
      pending: session.pendingFeedback.length,
      agent: session.agent || null,
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
    acknowledgeUiBatches,
    addAgentReply,
    setAgent,
    end,
    list,
    hasOpenSessions
  };
}

// UI Canvas options travel with the session so a reconnecting browser opens
// on the viewport the agent asked for. Unknown presets fall back to desktop.
function sanitizeUiOptions(raw, previous) {
  const base = previous && typeof previous === 'object' ? { ...previous } : {};
  const input = raw && typeof raw === 'object' ? raw : {};
  const out = { viewport: base.viewport || 'desktop', title: base.title || '' };
  if (typeof input.viewport === 'string' && /^(mobile|desktop|custom|\d{2,5}x\d{2,5})$/.test(input.viewport.trim())) {
    out.viewport = input.viewport.trim();
  }
  if (typeof input.title === 'string' && input.title.trim()) out.title = sanitizeText(input.title.trim(), 120);
  return out;
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
  SESSION_MODES,
  canonicalizeArtifactPath,
  createSessionStore,
  normalizeFeedbackItem,
  resolveStateDir,
  sanitizeUiOptions,
  sessionKeyFor
};
