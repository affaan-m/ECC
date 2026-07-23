'use strict';

/**
 * Control-pane integration for the agent-space proximity metric.
 *
 * Turns live sessions into agent working sets (the files each session's worktree
 * has changed), builds the dependency graph over those files, and runs the
 * TCAS-style airspace scan — so the board can surface "two agents are converging"
 * advisories and a 3D position per agent. See docs/design/agent-proximity.md.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const { scanAirspace, buildProximityTriggers } = require('../agent-proximity');
const { buildDependencyGraph } = require('../agent-proximity/graph');

/**
 * Parse `git diff --unified=0` output into per-file NEW-side line ranges. Hunk
 * headers look like `@@ -a,b +c,d @@`; we keep the +c,d (new) side so the overlap
 * channel can tell that two agents touch the *same file* but *different line
 * ranges* (different functions) and not flag a false collision.
 *
 * @param {string} diff
 * @returns {Map<string, Array<[number,number]>>}
 */
function parseDiffRanges(diff) {
  const byFile = new Map();
  let current = null;
  for (const line of String(diff || '').split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      const name = fileMatch[1].trim();
      current = name === '/dev/null' ? null : name;
      if (current && !byFile.has(current)) byFile.set(current, []);
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk && current) {
      const start = parseInt(hunk[1], 10);
      const count = hunk[2] === undefined ? 1 : parseInt(hunk[2], 10);
      if (count > 0) byFile.get(current).push([start, start + count - 1]);
    }
  }
  return byFile;
}

function runGitDiff(worktreePath, base, extraArgs) {
  return execFileSync('git', ['-C', worktreePath, 'diff', ...extraArgs, `${base}...HEAD`], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore']
  });
}

/**
 * Default working-set source: a session's worktree diff against its base, with
 * per-file changed line ranges. Returns [{ path, lines? }], or [] on failure so
 * proximity degrades gracefully (never throws into the snapshot path).
 */
function defaultWorkingSetFor(session) {
  const wt = session && session.worktree;
  if (!wt || !wt.path) return [];
  const base = wt.base || 'HEAD';
  try {
    const ranges = parseDiffRanges(runGitDiff(wt.path, base, ['--unified=0']));
    return [...ranges.entries()].map(([path, lines]) => (lines.length > 0 ? { path, lines } : { path }));
  } catch {
    return [];
  }
}

/**
 * Back-compat file-name-only source (no line ranges).
 */
function defaultChangedFilesFor(session) {
  const wt = session && session.worktree;
  if (!wt || !wt.path) return [];
  const base = wt.base || 'HEAD';
  try {
    return runGitDiff(wt.path, base, ['--name-only'])
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Map sessions to agent working sets. Only sessions with a worktree and at least
 * one changed file participate (an agent with no edits cannot collide).
 * Inject `workingSetFor` (returns [{path,lines?}]) or `changedFilesFor`
 * (returns file-name strings) for tests.
 */
function sessionsToAgents(sessions, deps = {}) {
  const workingSetFor = deps.workingSetFor || (deps.changedFilesFor ? session => deps.changedFilesFor(session).map(p => ({ path: p })) : defaultWorkingSetFor);
  const agents = [];
  for (const session of sessions || []) {
    const files = workingSetFor(session).map(f => ({ weight: 1, ...f }));
    if (files.length === 0) continue;
    agents.push({
      agentId: session.id,
      label: session.task || session.id,
      startedAt: session.createdAt || null,
      files
    });
  }
  return agents;
}

/**
 * Compute the proximity snapshot from the control-pane sessions.
 *
 * @param {Array} sessions normalized control-pane sessions
 * @param {object} [options] { repoRoot, changedFilesFor, ...scanOptions }
 * @returns {{ enabled, advisories, positions, links, counts }}
 */
function buildProximitySnapshot(sessions, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..', '..', '..'));
  const agents = sessionsToAgents(sessions, options);

  // Need at least two participating agents for a collision to be possible.
  if (agents.length < 2) {
    return {
      enabled: true,
      advisories: [],
      positions: agents.map(a => ({ agentId: a.agentId, position: [0, 0, 0], fileCount: a.files.length })),
      links: [],
      counts: { agents: agents.length, advisories: 0, resolutions: 0 }
    };
  }

  const touched = [...new Set(agents.flatMap(a => a.files.map(f => f.path)))];
  let graph = { adjacency: {}, files: [] };
  try {
    graph = options.graph || buildDependencyGraph(repoRoot, touched, options.graphDeps || {});
  } catch {
    graph = { adjacency: {}, files: [] };
  }

  const scan = scanAirspace(agents, graph, options);
  const labels = new Map(agents.map(a => [a.agentId, a.label]));
  const advisories = scan.advisories.map(adv => ({
    ...adv,
    aLabel: labels.get(adv.a) || adv.a,
    bLabel: labels.get(adv.b) || adv.b
  }));
  return {
    enabled: true,
    advisories,
    triggers: buildProximityTriggers(scan.advisories),
    positions: scan.positions,
    links: scan.links,
    counts: scan.counts
  };
}

/**
 * Deliver proximity triggers via an injected message sink. The sink is
 * `sendMessage({ fromSession, toSession, content, msgType })` — e.g. a writer
 * for the ECC `messages` table the control pane already reads. Best-effort:
 * a failing send is skipped, never thrown. Returns the dispatched count.
 */
function dispatchProximityTriggers(triggers, deps = {}) {
  const send = deps.sendMessage;
  if (typeof send !== 'function') return { dispatched: 0, skipped: (triggers || []).length };
  let dispatched = 0;
  let skipped = 0;
  for (const t of triggers || []) {
    try {
      send({ fromSession: t.from, toSession: t.to, content: t.content, msgType: t.type });
      dispatched += 1;
    } catch {
      skipped += 1;
    }
  }
  return { dispatched, skipped };
}

/**
 * Stateful dispatcher with per-trigger cooldown, so a collision that persists
 * across many ticks fires once and then stays quiet until it clears or the
 * cooldown lapses — agents get steered, not spammed. Inject `sendMessage`
 * (e.g. createEccMessageSink) and optionally `now`/`cooldownMs` for tests.
 */
function createProximityDispatcher(deps = {}) {
  const send = deps.sendMessage;
  const cooldownMs = Number.isFinite(deps.cooldownMs) ? deps.cooldownMs : 5 * 60 * 1000;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const lastFired = new Map();
  const keyOf = t => `${t.to}<-${t.from}:${t.type}`;

  return {
    dispatch(triggers) {
      let dispatched = 0;
      let suppressed = 0;
      let skipped = 0;
      for (const t of triggers || []) {
        const key = keyOf(t);
        const last = lastFired.get(key);
        const ts = now();
        if (last !== undefined && ts - last < cooldownMs) {
          suppressed += 1;
          continue;
        }
        if (typeof send !== 'function') {
          skipped += 1;
          continue;
        }
        try {
          send({ fromSession: t.from, toSession: t.to, content: t.content, msgType: t.type });
          lastFired.set(key, ts);
          dispatched += 1;
        } catch {
          skipped += 1;
        }
      }
      return { dispatched, suppressed, skipped };
    },
    reset() {
      lastFired.clear();
    }
  };
}

/**
 * One proximity tick: build the snapshot, then dispatch its triggers (steer the
 * agents). `buildSnapshot()` returns a control-pane snapshot with a `proximity`
 * field; `dispatcher` is a createProximityDispatcher. `dryRun` reports what
 * would fire without sending. Both are injected so the CLI stays a thin wrapper
 * and the logic is unit-testable.
 */
async function runProximityTick(deps = {}) {
  const snapshot = await deps.buildSnapshot();
  const prox = (snapshot && snapshot.proximity) || { advisories: [], triggers: [], counts: {} };
  const triggers = prox.triggers || [];
  let result;
  if (deps.dryRun || !deps.dispatcher) {
    result = { dispatched: 0, suppressed: 0, skipped: triggers.length, dryRun: Boolean(deps.dryRun) };
  } else {
    result = deps.dispatcher.dispatch(triggers);
  }
  return {
    counts: prox.counts || {},
    advisories: prox.advisories || [],
    triggers,
    result
  };
}

module.exports = {
  buildProximitySnapshot,
  sessionsToAgents,
  defaultWorkingSetFor,
  defaultChangedFilesFor,
  parseDiffRanges,
  dispatchProximityTriggers,
  createProximityDispatcher,
  runProximityTick
};
