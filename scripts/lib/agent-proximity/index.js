'use strict';

/**
 * Agent-proximity orchestration: scan all agents in a codebase, compute the
 * pairwise TCAS advisories that drive the steer/transmit triggers, and embed
 * each agent in 3D space for the "where are the agents" visualization.
 *
 * This is the call the control pane / hook layer makes each tick:
 *     const scan = scanAirspace(agents, graph)
 *     for (const a of scan.advisories) fireTrigger(a)   // transmit / steer
 *     renderViz(scan.positions, scan.advisories)        // 3D crawl view
 */

const crypto = require('crypto');
const { advise, collisionRisk, DEFAULTS } = require('./distance');
const { buildDependencyGraph, buildDependencyGraphFromSources } = require('./graph');

const { normalizePath, segments } = require('./distance')._internal;

/**
 * Deterministic hash of a string to a unit-ish vector in R^dims (components in
 * roughly [-1, 1]). Used to place tree prefixes in space.
 */
function hashVec(str, dims) {
  const digest = crypto.createHash('sha256').update(String(str)).digest();
  const v = new Array(dims).fill(0);
  for (let d = 0; d < dims; d += 1) {
    // Two bytes per dim → [-1, 1).
    const hi = digest[(d * 2) % digest.length];
    const lo = digest[(d * 2 + 1) % digest.length];
    v[d] = ((hi << 8) | lo) / 32768 - 1;
  }
  return v;
}

/**
 * Coordinate of a file: a space-filling embedding of its path. Files that share
 * a long directory prefix share most of their coordinate (deeper segments
 * perturb less), so tree-close files are space-close — exactly what eq. (6)
 * wants the visualization to show.
 */
function fileCoordinate(filePath, dims = 3) {
  const segs = segments(filePath);
  const v = new Array(dims).fill(0);
  let prefix = '';
  for (let i = 0; i < segs.length; i += 1) {
    prefix += '/' + segs[i];
    const h = hashVec(prefix, dims);
    const scale = 1 / Math.pow(2, i);
    for (let d = 0; d < dims; d += 1) v[d] += h[d] * scale;
  }
  return v;
}

/**
 * Pull a file's coordinate toward the coordinates of its dependency neighbours
 * (one averaging step), so coupled files that are far in the tree are drawn
 * closer in space — the dependency channel made visible.
 */
function smoothByDependency(coords, graph, alpha = 0.35) {
  const adj = (graph && graph.adjacency) || {};
  const out = {};
  for (const file of Object.keys(coords)) {
    const base = coords[file];
    const neighbours = (adj[file] || []).map(normalizePath).filter(n => coords[n]);
    if (neighbours.length === 0) {
      out[file] = base.slice();
      continue;
    }
    const dims = base.length;
    const avg = new Array(dims).fill(0);
    for (const n of neighbours) for (let d = 0; d < dims; d += 1) avg[d] += coords[n][d];
    for (let d = 0; d < dims; d += 1) avg[d] /= neighbours.length;
    out[file] = base.map((x, d) => (1 - alpha) * x + alpha * avg[d]);
  }
  return out;
}

function weightedCentroid(files, fileCoords, dims) {
  const v = new Array(dims).fill(0);
  let wsum = 0;
  for (const f of files) {
    const c = fileCoords[normalizePath(f.path)];
    if (!c) continue;
    const w = f.weight ?? 1;
    for (let d = 0; d < dims; d += 1) v[d] += c[d] * w;
    wsum += w;
  }
  if (wsum > 0) for (let d = 0; d < dims; d += 1) v[d] /= wsum;
  return v;
}

/**
 * Embed agents in R^dims for visualization. Returns one position per agent plus
 * the file coordinates used, so a renderer can draw both the agents and the
 * file-cloud they sit in.
 */
function embedAgents(agents, graph = {}, options = {}) {
  const dims = options.dims || 3;
  const fileCoords = {};
  for (const agent of agents) {
    for (const f of agent.files || []) {
      const p = normalizePath(f.path);
      if (!fileCoords[p]) fileCoords[p] = fileCoordinate(p, dims);
    }
  }
  const smoothed = smoothByDependency(fileCoords, graph, options.dependencyPull ?? 0.35);
  const positions = agents.map(agent => ({
    agentId: agent.agentId,
    position: weightedCentroid(agent.files || [], smoothed, dims),
    fileCount: (agent.files || []).length
  }));
  return { dims, positions, fileCoordinates: smoothed };
}

/**
 * Scan the whole airspace: pairwise advisories + 3D positions in one pass.
 *
 * @param {Array<{agentId,files,startedAt?,intent?}>} agents
 * @param {object} graph dependency graph (adjacency)
 * @param {object} [options]
 * @returns {{ advisories, positions, links, generatedAt }}
 */
function scanAirspace(agents, graph = {}, options = {}) {
  const list = Array.isArray(agents) ? agents.filter(a => a && a.agentId !== null && a.agentId !== undefined) : [];
  const advisories = [];
  const links = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const verdict = advise(a, b, graph, options);
      links.push({
        a: a.agentId,
        b: b.agentId,
        risk: verdict.risk,
        distance: verdict.distance,
        level: verdict.level
      });
      if (verdict.level !== 'clear') {
        advisories.push({ a: a.agentId, b: b.agentId, ...verdict });
      }
    }
  }
  advisories.sort((x, y) => y.risk - x.risk);
  links.sort((x, y) => y.risk - x.risk);
  const embedding = embedAgents(list, graph, options);
  return {
    advisories,
    positions: embedding.positions,
    fileCoordinates: embedding.fileCoordinates,
    links,
    counts: {
      agents: list.length,
      advisories: advisories.length,
      resolutions: advisories.filter(a => a.level === 'resolution').length
    }
  };
}

function clamp01(x) {
  return !Number.isFinite(x) ? 0 : x < 0 ? 0 : x > 1 ? 1 : x;
}
function pct(x) {
  return Math.round(clamp01(x) * 100);
}

/**
 * Turn airspace advisories into the messages to inject between agent sessions —
 * the concrete "transmit intent / steer away" actions. Transport-agnostic: each
 * trigger is { to, from, type, risk, content }; a dispatcher delivers them.
 */
function buildProximityTriggers(advisories) {
  const triggers = [];
  for (const adv of advisories || []) {
    if (adv.level === 'advisory') {
      // Traffic Advisory: both agents exchange intent.
      triggers.push({
        to: adv.a,
        from: adv.b,
        type: 'proximity_transmit',
        risk: adv.risk,
        content: `Proximity ${pct(adv.risk)}%: you and ${adv.b} are converging in code-space. Share what you're working on and check for overlap before continuing.`
      });
      triggers.push({
        to: adv.b,
        from: adv.a,
        type: 'proximity_transmit',
        risk: adv.risk,
        content: `Proximity ${pct(adv.risk)}%: you and ${adv.a} are converging in code-space. Share what you're working on and check for overlap before continuing.`
      });
    } else if (adv.level === 'resolution') {
      // Resolution Advisory: the lower-priority agent steers; the other holds.
      triggers.push({
        to: adv.steer,
        from: adv.hold,
        type: 'proximity_steer',
        risk: adv.risk,
        content: `Collision risk ${pct(adv.risk)}% with ${adv.hold}, which holds right-of-way. Steer away: move to a different file/area, or coordinate with ${adv.hold} before editing the shared region.`
      });
      triggers.push({
        to: adv.hold,
        from: adv.steer,
        type: 'proximity_hold',
        risk: adv.risk,
        content: `Collision risk ${pct(adv.risk)}% with ${adv.steer}; you hold right-of-way. ${adv.steer} has been asked to steer away — continue, but expect a handoff if they can't.`
      });
    }
  }
  return triggers;
}

module.exports = {
  DEFAULTS,
  scanAirspace,
  embedAgents,
  fileCoordinate,
  collisionRisk,
  advise,
  buildProximityTriggers,
  buildDependencyGraph,
  buildDependencyGraphFromSources
};
