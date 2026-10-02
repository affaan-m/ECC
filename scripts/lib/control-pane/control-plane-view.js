'use strict';

/**
 * ECC control-plane live view.
 *
 * One JSON document, `ecc.control-plane.view.v1`, that joins three things the
 * repo already computes separately:
 *
 *   1. the control-pane session snapshot (state.js): who is running where,
 *   2. the agent-proximity airspace scan (agent-proximity + proximity.js):
 *      pairwise collision risk over the shipped channels x_tree, x_overlap,
 *      x_dep, with the 2D PCA projection from agent-proximity/projection.js,
 *   3. the coordination inventory (coordination-inventory.js, PR #3028):
 *      declared tasks and sessions, heartbeat freshness, lease conflicts.
 *
 * The output is shaped as tasks, lanes and events so another control plane
 * (the Ito ops board) can consume it without knowing ECC internals:
 *
 *   task   = one agent session (id, lane, harness, state, worktree, working
 *            set size, projected point, inventory observation)
 *   lane   = a grouping of tasks (task group, project, or harness)
 *   event  = something an operator or a hook may act on. Today: a proximity
 *            advisory at a static threshold, or a lease conflict.
 *
 * Everything here is read-only and advisory. The view does not acquire
 * leases, does not steer agents and does not claim a conflict-reduction
 * number. See docs/control-plane/VIEW-CONTRACT.md.
 */

const { DEFAULTS, rightOfWay } = require('../agent-proximity/distance');
const { projectPairs, createProjectionWindow } = require('../agent-proximity/projection');

const VIEW_SCHEMA_VERSION = 'ecc.control-plane.view.v1';
const EVENT_KINDS = {
  advisory: 'proximity.advisory',
  leaseConflict: 'inventory.lease-conflict'
};

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/;
const OPEN_STATES = new Set(['running', 'pending', 'idle']);
const CLOSED_STATES = new Set(['completed', 'failed', 'stopped']);

function isoOrNull(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Map a session id to an identifier the inventory accepts. Replaces anything
 * outside the allowed alphabet, strips a leading non-alphanumeric run, and
 * falls back to a positional id. Callers get the mapping back so a consumer
 * can join inventory rows to tasks.
 */
function inventoryIdFor(id, index, taken) {
  let candidate = String(id || '')
    .replace(/[^a-zA-Z0-9_.:-]/g, '-')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .slice(0, 200);
  if (!candidate || ['__proto__', 'constructor', 'prototype'].includes(candidate)) candidate = `task-${index + 1}`;
  let unique = candidate;
  let n = 2;
  while (taken.has(unique)) {
    unique = `${candidate.slice(0, 190)}-${n}`;
    n += 1;
  }
  taken.add(unique);
  return IDENTIFIER.test(unique) ? unique : `task-${index + 1}`;
}

function laneFor(session) {
  if (session.taskGroup) return { id: `group:${session.taskGroup}`, label: session.taskGroup, kind: 'task-group' };
  if (session.project) return { id: `project:${session.project}`, label: session.project, kind: 'project' };
  const harness = session.harness || 'unknown';
  return { id: `harness:${harness}`, label: harness, kind: 'harness' };
}

function sessionDeclarationStatus(state) {
  if (OPEN_STATES.has(state)) return 'open';
  if (CLOSED_STATES.has(state)) return 'closed';
  return 'unknown';
}

/**
 * Build the #3028 manifest from live sessions plus the working sets the
 * proximity scan already extracted. Declared-only by construction: the
 * inventory library labels every row `declared-only` and this view keeps
 * that label.
 */
function buildInventoryManifest(sessions, agentsById, options = {}) {
  const taken = new Set();
  const idMap = new Map();
  const tasks = [];
  const declaredSessions = [];
  const limited = (sessions || []).slice(0, 64);
  limited.forEach((session, index) => {
    const invId = inventoryIdFor(session.id, index, taken);
    idMap.set(session.id, invId);
    const agent = agentsById.get(session.id);
    const paths = (agent ? agent.files : []).filter(p => typeof p === 'string' && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.split('/').some(x => !x || x === '.' || x === '..')).slice(0, 128);
    tasks.push({
      id: invId,
      repoId: null,
      paths,
      pid: Number.isSafeInteger(session.pid) && session.pid > 0 ? session.pid : null,
      status: String(session.state || 'unknown').slice(0, 200) || 'unknown',
      heartbeatAt: isoOrNull(session.lastHeartbeatAt),
      statusFileModifiedAt: isoOrNull(session.updatedAt)
    });
    declaredSessions.push({
      id: invId,
      taskId: invId,
      goalId: null,
      status: sessionDeclarationStatus(session.state),
      updatedAt: isoOrNull(session.lastHeartbeatAt || session.updatedAt)
    });
  });
  const extra = options.manifest && typeof options.manifest === 'object' ? options.manifest : {};
  return {
    manifest: {
      version: 1,
      repositories: Array.isArray(extra.repositories) ? extra.repositories : [],
      tasks: [...tasks, ...(Array.isArray(extra.tasks) ? extra.tasks : [])],
      sessions: [...declaredSessions, ...(Array.isArray(extra.sessions) ? extra.sessions : [])],
      goals: Array.isArray(extra.goals) ? extra.goals : [],
      leases: Array.isArray(extra.leases) ? extra.leases : []
    },
    idMap,
    truncated: (sessions || []).length > limited.length
  };
}

function runInventory(sessions, agentsById, options = {}) {
  const built = buildInventoryManifest(sessions, agentsById, options);
  try {
    const { buildInventory } = options.inventoryModule || require('../coordination-inventory');
    const report = buildInventory(built.manifest, { now: options.now, resources: options.resources });
    return { status: 'ok', idMap: built.idMap, truncated: built.truncated, report };
  } catch (error) {
    return { status: 'unavailable', idMap: built.idMap, truncated: built.truncated, reason: error.message, report: null };
  }
}

/**
 * Agent shape the right-of-way rule needs, rebuilt from the proximity
 * snapshot's agent summaries (progress = recency-weighted file count).
 */
function priorityAgent(summary, agentId) {
  if (!summary) return { agentId, files: [], startedAt: null };
  const progress = Number.isFinite(summary.progress) ? summary.progress : summary.fileCount || 0;
  return { agentId, startedAt: summary.startedAt || null, files: [{ path: '', weight: progress }] };
}

/**
 * Static-threshold advisory events, derived from every pair link against the
 * view's own thresholds so an override changes the events, not only labels.
 * The risk itself comes from the scan (noisy-OR, unchanged).
 */
function advisoryEvents(links, agentsById, thresholds, at) {
  const events = [];
  for (const link of links || []) {
    if (!link || !Number.isFinite(link.risk) || link.risk < thresholds.ta) continue;
    const resolution = link.risk >= thresholds.ra;
    const level = resolution ? 'resolution' : 'traffic';
    const a = agentsById.get(link.a);
    const b = agentsById.get(link.b);
    const aLabel = (a && a.label) || link.a;
    const bLabel = (b && b.label) || link.b;
    const way = resolution ? rightOfWay(priorityAgent(a, link.a), priorityAgent(b, link.b)) : { steer: null, hold: null };
    const channels = link.channels || {};
    events.push({
      id: `${EVENT_KINDS.advisory}:${link.a}|${link.b}:${level}`,
      kind: EVENT_KINDS.advisory,
      level,
      severity: resolution ? 'critical' : 'warning',
      at,
      subject: { a: link.a, b: link.b, aLabel, bLabel },
      risk: link.risk,
      distance: Number.isFinite(link.distance) ? link.distance : 1 - link.risk,
      channels: {
        x_tree: Number.isFinite(channels.tree) ? channels.tree : null,
        x_overlap: Number.isFinite(channels.overlap) ? channels.overlap : null,
        x_dep: Number.isFinite(channels.dependency) ? channels.dependency : null
      },
      threshold: { ta: thresholds.ta, ra: thresholds.ra, crossed: resolution ? 'ra' : 'ta', source: 'static' },
      action: resolution ? { type: 'steer', steer: way.steer, hold: way.hold } : { type: 'transmit', steer: null, hold: null },
      message: resolution
        ? `Resolution advisory: ${way.steer} steers, ${way.hold} holds (risk ${Math.round(link.risk * 100)}%, static threshold ${thresholds.ra}).`
        : `Traffic advisory: ${link.a} and ${link.b} transmit intent (risk ${Math.round(link.risk * 100)}%, static threshold ${thresholds.ta}).`
    });
  }
  events.sort((x, y) => y.risk - x.risk);
  return events;
}

function leaseConflictEvents(report, at) {
  if (!report || !Array.isArray(report.leaseConflicts)) return [];
  return report.leaseConflicts.map(conflict => ({
    id: `${EVENT_KINDS.leaseConflict}:${conflict.resource}`,
    kind: EVENT_KINDS.leaseConflict,
    level: 'conflict',
    severity: 'warning',
    at,
    subject: { resource: conflict.resource, owners: conflict.owners },
    action: { type: 'review', steer: null, hold: null },
    message: `Declared lease conflict on ${conflict.resource}: ${conflict.owners.join(', ')}. Declared-only, not a lock.`
  }));
}

/**
 * Build the live view from a control-pane snapshot that already carries a
 * `proximity` field (buildControlPaneSnapshot with includeProximity: true).
 *
 * @param {object} snapshot control-pane snapshot
 * @param {object} [options] { window, thresholds, now, manifest, resources, channelWeights }
 */
function buildControlPlaneView(snapshot, options = {}) {
  const at = options.now || new Date().toISOString();
  const thresholds = { ...DEFAULTS.thresholds, ...(options.thresholds || {}) };
  const sessions = Array.isArray(snapshot && snapshot.sessions) ? snapshot.sessions : [];
  const prox = (snapshot && snapshot.proximity) || {};
  const agents = Array.isArray(prox.agents) ? prox.agents : [];
  const agentsById = new Map(agents.map(a => [a.agentId, a]));

  const projection = projectPairs(prox.links || [], {
    window: options.window,
    channelWeights: options.channelWeights,
    sample: options.sample,
    minWindowForZscore: options.minWindowForZscore
  });
  const pointByAgent = new Map(projection.agents.map(a => [a.agentId, a]));

  const inventory = runInventory(sessions, agentsById, {
    now: at,
    manifest: options.manifest,
    resources: options.resources,
    inventoryModule: options.inventoryModule
  });
  const inventoryTaskById = new Map();
  if (inventory.report) for (const task of inventory.report.tasks || []) inventoryTaskById.set(task.id, task);

  const lanes = new Map();
  const tasks = sessions.map(session => {
    const lane = laneFor(session);
    if (!lanes.has(lane.id)) lanes.set(lane.id, { ...lane, taskIds: [] });
    lanes.get(lane.id).taskIds.push(session.id);
    const agent = agentsById.get(session.id);
    const projected = pointByAgent.get(session.id);
    const invId = inventory.idMap.get(session.id) || null;
    const invTask = invId ? inventoryTaskById.get(invId) : null;
    return {
      id: session.id,
      lane: lane.id,
      label: session.task || session.id,
      harness: session.harness || 'unknown',
      agentType: session.agentType || '',
      state: session.state || 'unknown',
      pid: session.pid === undefined ? null : session.pid,
      worktree: session.worktree || null,
      heartbeatAt: isoOrNull(session.lastHeartbeatAt),
      updatedAt: isoOrNull(session.updatedAt),
      workingSet: { fileCount: agent ? agent.fileCount : 0, files: agent ? agent.files : [] },
      projection: projected ? { point: projected.point, pairs: projected.pairs, maxRisk: projected.maxRisk } : { point: null, pairs: 0, maxRisk: 0 },
      inventory: invTask ? { id: invId, heartbeat: invTask.heartbeat, process: invTask.process, authority: 'declared-only' } : { id: invId, heartbeat: null, process: null, authority: 'declared-only' }
    };
  });

  const events = [...advisoryEvents(prox.links, agentsById, thresholds, at), ...leaseConflictEvents(inventory.report, at)];

  const { pairs, agents: projectedAgents, ...projectionMeta } = projection;
  return {
    schemaVersion: VIEW_SCHEMA_VERSION,
    generatedAt: at,
    source: {
      snapshotSchema: snapshot ? snapshot.schemaVersion || null : null,
      repoRoot: snapshot ? snapshot.repoRoot || null : null,
      dbPath: snapshot ? snapshot.dbPath || null : null
    },
    thresholds: { ta: thresholds.ta, ra: thresholds.ra, source: 'static' },
    lanes: [...lanes.values()],
    tasks,
    pairs,
    events,
    projection: { ...projectionMeta, agents: projectedAgents },
    inventory: inventory.report
      ? {
          status: 'ok',
          truncated: inventory.truncated,
          observedAt: inventory.report.observedAt,
          mode: inventory.report.mode,
          activity: inventory.report.activity,
          leaseConflicts: inventory.report.leaseConflicts,
          warnings: inventory.report.warnings,
          coverage: inventory.report.coverage,
          limits: inventory.report.limits
        }
      : { status: inventory.status, truncated: inventory.truncated, reason: inventory.reason || null },
    counts: {
      lanes: lanes.size,
      tasks: tasks.length,
      agents: agents.length,
      pairs: pairs.length,
      events: events.length,
      advisories: events.filter(e => e.kind === EVENT_KINDS.advisory).length,
      resolutions: events.filter(e => e.kind === EVENT_KINDS.advisory && e.level === 'resolution').length
    },
    limits: [
      'Advisories use static thresholds; no learned threshold and no conflict-reduction claim.',
      'Projection is a display over the shipped channels x_tree, x_overlap, x_dep; it does not change risk.',
      'Inventory rows are declared-only observations; leases are not locks.',
      'The view does not steer, pause or lock any agent.'
    ]
  };
}

/**
 * Stateful view builder for a long-lived server: keeps one projection window
 * so z-scores roll over ticks. `buildSnapshot()` is injected (it is the
 * control-pane snapshot with includeProximity: true).
 */
function createControlPlaneViewSource(deps = {}) {
  const window = deps.window || createProjectionWindow(deps.projection || {});
  const clock = deps.clock || Date.now;
  const interval = deps.sampleIntervalMs === undefined ? 5000 : deps.sampleIntervalMs;
  if (!Number.isFinite(interval) || interval <= 0) throw new Error('sampleIntervalMs must be positive and finite');
  let cached = null;
  let pending = null;
  let expiresAt = 0;
  async function refresh() {
    const snapshot = await deps.buildSnapshot();
    const view = buildControlPlaneView(snapshot, { ...deps.viewOptions, window });
    cached = { snapshot, view };
    expiresAt = clock() + interval;
    return cached;
  }
  return {
    window,
    async build(extra = {}) {
      if (!cached || clock() >= expiresAt) {
        if (!pending) pending = refresh().finally(() => { pending = null; });
        await pending;
      }
      if (Object.keys(extra).length === 0) return cached.view;
      return buildControlPlaneView(cached.snapshot, {
        ...deps.viewOptions, ...extra, now: extra.now || cached.view.generatedAt, window, sample: false
      });
    }
  };
}

module.exports = {
  VIEW_SCHEMA_VERSION,
  EVENT_KINDS,
  buildControlPlaneView,
  createControlPlaneViewSource,
  buildInventoryManifest,
  _internal: { inventoryIdFor, laneFor, sessionDeclarationStatus, advisoryEvents, leaseConflictEvents }
};
