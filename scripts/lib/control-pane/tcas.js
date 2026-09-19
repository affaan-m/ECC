'use strict';

const fs = require('fs');
const http = require('http');

const DEFAULT_POLL_INTERVAL_MS = 1000;
const MAX_EVENT_AGE_MS = 3000;

function normalizePath(value) {
  return typeof value === 'string' ? value.replace(/\\/g, '/').replace(/^\.\//, '') : '';
}

function eventIncludesSession(event, sessionId) {
  const subject = event?.subject;
  return Boolean(sessionId && subject && (
    (typeof subject === 'string' && subject.split('|').includes(sessionId))
    || (subject.a === sessionId || subject.b === sessionId)
  ));
}

function isFresh(event, now = Date.now(), pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {
  const at = Date.parse(event?.at || '');
  return Number.isFinite(at) && now - at <= Math.max(pollIntervalMs * 3, MAX_EVENT_AGE_MS);
}

function workingSetIncludes(event, filePath, sessionId) {
  const normalized = normalizePath(filePath);
  const other = event?.action?.steer === sessionId ? event.action.hold : event?.action?.hold === sessionId ? event.action.steer : null;
  return Boolean(normalized && other && Array.isArray(event.workingSets?.[other]) && event.workingSets[other].some(file => {
    const candidate = normalizePath(file);
    return candidate === normalized || candidate.endsWith(`/${normalized}`) || normalized.endsWith(`/${candidate}`);
  }));
}

function decide(events, input, options = {}) {
  const now = options.now ?? Date.now();
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sessionId = input?.session_id;
  const filePath = input?.tool_input?.file_path;
  const tool = input?.tool_name || 'unknown';
  if (!sessionId) return { maneuver: 'allow', blocked: false, reason: 'missing session id' };

  for (const event of Array.isArray(events) ? events : []) {
    if (event?.kind !== 'proximity.advisory' || !eventIncludesSession(event, sessionId) || !isFresh(event, now, pollIntervalMs)) continue;
    const type = event.action?.type;
    if (event.level === 'traffic' && type === 'transmit') {
      return { maneuver: 'transmit', blocked: false, event, tool, file: filePath, reason: event.message || 'nearby working set detected' };
    }
    if (event.level !== 'resolution' || type !== 'steer') continue;
    if (event.action?.hold === sessionId) {
      return { maneuver: 'hold', blocked: false, event, tool, file: filePath, reason: event.message || 'continue; another agent has right of way' };
    }
    if (event.action?.steer === sessionId) {
      const shared = workingSetIncludes(event, filePath, sessionId);
      return { maneuver: shared ? 'pause' : 'wait', blocked: shared, event, tool, file: filePath, reason: shared ? 'file is in the other agent working set' : 'use a disjoint file or subtree' };
    }
  }
  return { maneuver: 'allow', blocked: false, tool, file: filePath, reason: 'no applicable advisory' };
}

function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function fetchJson(url, timeoutMs = 120) {
  return new Promise(resolve => {
    const request = http.get(url, { timeout: timeoutMs }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { resolve(response.statusCode === 200 ? JSON.parse(body) : null); } catch { resolve(null); }
      });
    });
    request.on('error', () => resolve(null));
    request.on('timeout', () => { request.destroy(); resolve(null); });
  });
}

async function readEvents(env = process.env) {
  const file = String(env.ECC_TCAS_EVENTS_FILE || '').trim();
  if (file) {
    const document = readJsonFile(file);
    return Array.isArray(document) ? document : document?.events || [];
  }
  const eventsUrl = String(env.ECC_TCAS_EVENTS_URL || 'http://127.0.0.1:4173/api/control-plane/events').trim();
  const document = await fetchJson(eventsUrl);
  const events = document?.events || [];
  const viewUrl = String(env.ECC_TCAS_VIEW_URL || eventsUrl.replace(/\/api\/control-plane\/events\/?$/, '/api/control-plane')).trim();
  const view = await fetchJson(viewUrl);
  const workingSets = Object.fromEntries((view?.tasks || []).map(task => [task.id, (task.workingSet?.files || []).map(file => typeof file === 'string' ? file : file.path)]));
  return events.map(event => ({ ...event, workingSets }));
}

function appendDecision(decision, input, env = process.env) {
  const capsuleDir = String(env.ECC_CAPSULE_DIR || '').trim();
  if (!capsuleDir) return null;
  try {
    const { Capsule } = require('../eval-harness/capsule');
    const capsule = Capsule.open(capsuleDir);
    return capsule.append('interaction', 'tcas.decision', {
      event_id: decision.event?.id || 'none', session: input?.session_id || 'unknown', tool: decision.tool || 'unknown',
      file: decision.file || '', maneuver: decision.maneuver, blocked: decision.blocked ? 1 : 0,
      risk: Number(decision.event?.risk || 0), threshold: JSON.stringify(decision.event?.threshold || {}),
    }, { effect_class: 'SE1', strict: false });
  } catch { return null; }
}

module.exports = { DEFAULT_POLL_INTERVAL_MS, MAX_EVENT_AGE_MS, normalizePath, isFresh, decide, readEvents, appendDecision };
