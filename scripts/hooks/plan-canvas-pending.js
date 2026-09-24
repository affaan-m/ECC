#!/usr/bin/env node
/**
 * Plan Canvas undelivered-feedback guard (Stop)
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Browser feedback only reaches an agent while that agent is parked inside
 * `ecc-plan-canvas await`. The moment a turn ends, nothing is listening, so
 * messages the human sends land in sessions.json and stay there: the canvas
 * looks alive, the agent never hears a word.
 *
 * This hook closes that gap. On Stop it drains any undelivered feedback for
 * the current project and blocks the stop, handing the messages to the agent
 * as its next input, so a canvas message is delivered even when no `await`
 * was running.
 *
 * Scope: sessions whose artifact lives under the hook's cwd, so parallel
 * agents in other repos cannot swallow a message meant for this one. Set
 * ECC_PLAN_CANVAS_STOP_SCOPE=all to consider every open session.
 *
 * Never blocks on failure: any error, unreachable server, or undrainable
 * queue exits 0 with stdin passed through.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

// Loopback only, and short: a Stop hook must not stall the turn if the canvas
// server is wedged. Falling back to the state file keeps delivery working.
const SERVER_TIMEOUT_MS = 1000;
const MAX_ITEMS_REPORTED = 20;

function stateDir() {
  const override = process.env.ECC_PLAN_CANVAS_STATE_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(os.homedir(), '.claude', 'plan-canvas');
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(stateDir(), 'sessions.json'), 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.sessions ? parsed : null;
  } catch {
    return null;
  }
}

function readServerPort() {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(stateDir(), 'server.json'), 'utf8'));
    return Number.isInteger(info.port) ? info.port : null;
  } catch {
    return null;
  }
}

function isInside(dir, file) {
  if (!dir) return true;
  const base = path.resolve(dir);
  const target = path.resolve(file);
  return target === base || target.startsWith(base + path.sep);
}

/**
 * Sessions holding feedback the agent has never seen, oldest activity first.
 */
function pendingSessions(state, cwd, env = process.env) {
  const scopeAll = String(env.ECC_PLAN_CANVAS_STOP_SCOPE || '').trim().toLowerCase() === 'all';
  return Object.values((state && state.sessions) || {})
    .filter(session => session && session.status !== 'ended')
    .filter(session => Array.isArray(session.pendingFeedback) && session.pendingFeedback.length > 0)
    .filter(session => (scopeAll ? true : isInside(cwd, session.file)))
    .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
}

/**
 * Ask the running server to hand over the batch. The server owns sessions.json
 * while it is up, so this is the only race-free way to drain. timeoutMs=0
 * makes /api/await return immediately instead of long polling.
 */
function drainViaServer(port, key) {
  return new Promise(resolve => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: `/api/await?key=${encodeURIComponent(key)}&timeoutMs=0`,
        agent: false
      },
      res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data.trim() || '{}');
            resolve(parsed.status === 'feedback' && Array.isArray(parsed.items) ? parsed : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.setTimeout(SERVER_TIMEOUT_MS, () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

/**
 * Drain straight from disk. Only safe when no server is listening, which is
 * exactly when this path runs: with the server down nothing else mutates the
 * file, and leaving the items queued would re-block on every future Stop.
 */
function drainViaFile(key) {
  const file = path.join(stateDir(), 'sessions.json');
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const session = state.sessions && state.sessions[key];
    if (!session || !Array.isArray(session.pendingFeedback) || session.pendingFeedback.length === 0) {
      return null;
    }
    const items = session.pendingFeedback;
    const sessionEnded = session.status === 'ended';
    session.pendingFeedback = [];
    if (!sessionEnded) session.status = 'open';
    session.updatedAt = new Date().toISOString();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
    return { status: 'feedback', items, sessionEnded };
  } catch {
    return null;
  }
}

function describeItem(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.kind === 'verdict') {
    const label = item.verdict === 'approve' ? 'APPROVED the plan' : 'REQUESTED CHANGES';
    return item.text ? `${label}: ${item.text}` : label;
  }
  if (item.kind === 'annotation') {
    const anchor = item.anchor || {};
    const where = anchor.snippet || anchor.selector || 'the artifact';
    return item.text ? `on "${where}": ${item.text}` : null;
  }
  return item.text || null;
}

function buildReason(delivered) {
  const lines = [
    'Plan Canvas: the human sent feedback in the browser that was never delivered to you.',
    'Handle it now instead of ending the turn.',
    ''
  ];
  for (const entry of delivered) {
    lines.push(`Artifact: ${entry.file}`);
    for (const text of entry.messages.slice(0, MAX_ITEMS_REPORTED)) lines.push(`  - ${text}`);
    const extra = entry.messages.length - MAX_ITEMS_REPORTED;
    if (extra > 0) lines.push(`  - (+${extra} more)`);
    if (entry.sessionEnded) {
      lines.push('  The user ended this review after sending. Address the feedback and report back in');
      lines.push('  your normal reply; do not reopen the canvas.');
    } else {
      lines.push('  Reply IN THE CANVAS so the human sees it, and keep listening, with one command:');
      lines.push(`    ecc-plan-canvas await ${JSON.stringify(entry.file)} --reply "<what you did>"`);
    }
    lines.push('');
  }
  lines.push('Run that await in the background so the next message reaches you without another Stop.');
  return lines.join('\n');
}

async function collectDeliveries(sessions, port) {
  const delivered = [];
  for (const session of sessions) {
    const result = port ? await drainViaServer(port, session.key) : drainViaFile(session.key);
    // A failed drain is deliberately not reported: blocking on feedback that
    // is still queued would re-fire on every subsequent Stop.
    if (!result) continue;
    const messages = result.items.map(describeItem).filter(Boolean);
    if (messages.length === 0) continue;
    delivered.push({ file: session.file, messages, sessionEnded: Boolean(result.sessionEnded) });
  }
  return delivered;
}

async function run(rawInput) {
  const passThrough = { stdout: rawInput || '', exitCode: 0 };
  let payload = {};
  try {
    payload = JSON.parse(rawInput || '{}');
  } catch {
    return passThrough;
  }

  // The harness sets this once it has already resumed the agent from a Stop
  // hook. Blocking again from here is how a hook wedges a session.
  if (payload.stop_hook_active) return passThrough;

  const state = readState();
  if (!state) return passThrough;

  const sessions = pendingSessions(state, payload.cwd || process.cwd());
  if (sessions.length === 0) return passThrough;

  const delivered = await collectDeliveries(sessions, readServerPort());
  if (delivered.length === 0) return passThrough;

  return {
    stdout: JSON.stringify({ decision: 'block', reason: buildReason(delivered) }),
    exitCode: 0
  };
}

module.exports = { run, pendingSessions, describeItem, buildReason, drainViaFile };
