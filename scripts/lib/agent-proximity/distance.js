'use strict';

/**
 * Agent-space distance metric + collision avoidance (ECC 2.0, Layer 4 v0).
 *
 * Two agents editing the same codebase are like two aircraft sharing airspace:
 * we want a continuous notion of "how close are they" so that, as they approach,
 * we fire a TCAS-style protocol — first a Traffic Advisory (exchange intent),
 * then a Resolution Advisory (one steers away) — *before* they collide at the
 * git/merge layer.
 *
 * ── The state of an agent ──────────────────────────────────────────────────
 * At time t, agent a has a working set
 *     W_a = { (f, R_f, w_f) }                                            (1)
 * where f is a file it has touched, R_f the set of line ranges it edited in f,
 * and w_f ∈ (0,1] a recency weight (older edits decay). Optionally an agent
 * declares an intent set I_a of files it is about to touch.
 *
 * ── Collision is multi-channel ─────────────────────────────────────────────
 * Two agents can collide through several independent channels, so we model a
 * per-channel collision probability r_i ∈ [0,1] and combine with a noisy-OR
 * (probability of colliding through *at least one* channel):
 *     R(a,b) = 1 − Π_i (1 − ω_i · r_i)                                   (2)
 * with channel weights ω_i ∈ [0,1]. R is the agent-distance's dual: we report
 * both the risk R ∈ [0,1] and a distance D = 1 − R.
 *
 * Channels (each defined below):
 *   r_overlap — same file / overlapping line ranges (imminent)
 *   r_dep     — one agent's files depend on the other's (collision even when
 *               far apart in the tree: edit there breaks here)
 *   r_tree    — proximity in the directory tree (a soft prior)
 *
 * ── Channel 1: edit overlap ────────────────────────────────────────────────
 * For each shared file f ∈ files(W_a) ∩ files(W_b), the overlap COEFFICIENT
 * (Szymkiewicz–Simpson) over the edited line ranges:
 *         lineOverlap(f) = |R_f^a ∩ R_f^b| / min(|R_f^a|, |R_f^b|)
 * (the right collision measure — high when one agent's edit sits inside the
 * other's region even if that region is huge; =1 when either side is a whole-file
 * edit). The channel risk is the recency-weighted max across shared files:
 *   r_overlap = max_{f∈S} w_f^a·w_f^b · lineOverlap(f).                     (3)
 * Different files ⇒ no shared f ⇒ r_overlap = 0 (tree/dep channels take over).
 *
 * ── Channel 2: dependency coupling ─────────────────────────────────────────
 * Build a directed dependency graph G=(V,E), V=files, edge f→g iff f imports g.
 * Even if f and g are in distant subtrees, if f (agent a) depends on g (agent b)
 * then b's edit to g can break a. Coupling decays with graph distance:
 *         coupling(f,g) = γ^{ d_G(f,g) − 1 }   (γ∈(0,1)), 0 if unreachable. (4)
 * A direct edge (d_G=1) ⇒ coupling=1. We take the recency-weighted max over
 * cross pairs:
 *   r_dep = max_{f∈W_a, g∈W_b} w_f·w_g·max(coupling(f,g), coupling(g,f)).  (5)
 *
 * ── Channel 3: tree proximity ──────────────────────────────────────────────
 * For two paths split into segments with lowest-common-ancestor depth L:
 *   treeDistance(f,g) = ((depth_f − L) + (depth_g − L)) / (depth_f + depth_g) (6)
 *     (0 = same file, 1 = disjoint roots).  r_tree = 1 − min cross-pair treeDist.
 * Tree proximity alone rarely causes a collision, so ω_tree is small — it nudges
 * the metric, it does not dominate it.
 *
 * ── TCAS protocol ──────────────────────────────────────────────────────────
 * Two thresholds carve a protected zone:
 *   R < τ_TA              → CLEAR
 *   τ_TA ≤ R < τ_RA       → TRAFFIC ADVISORY: each agent transmits what it is
 *                            doing/has done to the other (the scout handshake)
 *   R ≥ τ_RA              → RESOLUTION ADVISORY: the lower-priority agent steers
 *                            away; the higher-priority one holds course.
 * Like TCAS coordinating climb/descend, the resolution is *coordinated* and
 * deterministic so both agents never pick the same maneuver: priority(a) breaks
 * the tie (right-of-way to the agent with more committed work / earlier start;
 * stable agentId as the final tiebreak). See advise().
 *
 * ── Vector-space view ──────────────────────────────────────────────────────
 * embedAgent() places each agent at the recency-weighted centroid of its files'
 * coordinates, where a file's coordinate is a low-dim hash of its path segments
 * smoothed toward its dependency neighbours. Then ‖v_a − v_b‖ tracks R, which is
 * what a 3D "where are the agents" visualization renders. See embed.js.
 */

const DEFAULTS = {
  channelWeights: { overlap: 1.0, dependency: 0.9, tree: 0.25 },
  depDecay: 0.5, // γ in (4)
  recencyFloor: 0.15, // weight never decays below this so stale-but-relevant files still count
  thresholds: { ta: 0.35, ra: 0.7 } // τ_TA, τ_RA
};

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function normalizePath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

function segments(p) {
  return normalizePath(p).split('/').filter(Boolean);
}

/**
 * Tree distance ∈ [0,1] between two file paths — eq. (6). 0 = same file.
 */
function treeDistance(a, b) {
  const sa = segments(a);
  const sb = segments(b);
  if (sa.length === 0 || sb.length === 0) return 1;
  let lca = 0;
  while (lca < sa.length && lca < sb.length && sa[lca] === sb[lca]) lca += 1;
  const da = sa.length;
  const db = sb.length;
  if (da === db && lca === da) return 0; // identical path
  return clamp01((da - lca + (db - lca)) / (da + db));
}

/**
 * Line-range overlap as the overlap COEFFICIENT (Szymkiewicz–Simpson):
 * |A ∩ B| / min(|A|, |B|). This is the right collision measure — if one agent's
 * edit sits largely inside the other's region the score is high even when the
 * other region is huge (Jaccard would dilute it by union size). Empty/absent
 * ranges ⇒ whole-file edit ⇒ full overlap (1). Each range is [start,end] inclusive.
 */
function lineRangeOverlap(rangesA, rangesB) {
  const a = Array.isArray(rangesA) ? rangesA : [];
  const b = Array.isArray(rangesB) ? rangesB : [];
  if (a.length === 0 || b.length === 0) return 1; // file-level edit ⇒ whole-file overlap
  const covered = ranges => {
    const set = new Set();
    for (const [s, e] of ranges) {
      const lo = Math.min(s, e);
      const hi = Math.max(s, e);
      for (let i = lo; i <= hi; i += 1) set.add(i);
    }
    return set;
  };
  const ca = covered(a);
  const cb = covered(b);
  if (ca.size === 0 || cb.size === 0) return 0;
  let inter = 0;
  for (const v of ca) if (cb.has(v)) inter += 1;
  return inter / Math.min(ca.size, cb.size);
}

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  for (const v of setA) if (setB.has(v)) inter += 1;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Channel 1 — edit overlap, eq. (3).
 */
function overlapRisk(a, b) {
  const filesA = a.files || [];
  const filesB = b.files || [];
  const byPathB = new Map(filesB.map(f => [normalizePath(f.path), f]));
  // Per shared file, the (line-precise) overlap — lineRangeOverlap returns 1 when
  // either side lacks ranges (a whole-file edit). The risk is the max across
  // shared files: even one fully-overlapping file is a collision, while the same
  // file edited in disjoint line ranges scores low. No coarse file-set Jaccard
  // floor (it would max out for any shared file and mask line-level disjointness).
  let r = 0;
  for (const fa of filesA) {
    const fb = byPathB.get(normalizePath(fa.path));
    if (fb) {
      const w = (fa.weight ?? 1) * (fb.weight ?? 1);
      r = Math.max(r, w * lineRangeOverlap(fa.lines, fb.lines));
    }
  }
  return clamp01(r);
}

/**
 * Shortest-path distance in a directed dependency graph, treated as undirected
 * for reachability (a depends-on edge couples both endpoints). BFS, capped.
 */
function graphDistance(graph, from, to, cap = 6) {
  const start = normalizePath(from);
  const goal = normalizePath(to);
  if (start === goal) return 0;
  const adj = graph && graph.adjacency ? graph.adjacency : graph || {};
  const seen = new Set([start]);
  let frontier = [start];
  for (let depth = 1; depth <= cap; depth += 1) {
    const next = [];
    for (const node of frontier) {
      const neighbours = adj[node] || [];
      for (const nb of neighbours) {
        const n = normalizePath(nb);
        if (n === goal) return depth;
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return Infinity;
}

/**
 * Channel 2 — dependency coupling, eqs. (4)-(5).
 */
function dependencyRisk(a, b, graph, opts = {}) {
  const decay = opts.depDecay ?? DEFAULTS.depDecay;
  const filesA = a.files || [];
  const filesB = b.files || [];
  let r = 0;
  for (const fa of filesA) {
    for (const fb of filesB) {
      // A depends-on edge couples both endpoints, so use the smaller of the two
      // directed distances (importer→imported or imported→importer).
      const d = Math.min(graphDistance(graph, fa.path, fb.path), graphDistance(graph, fb.path, fa.path));
      if (d === Infinity || d === 0) continue;
      const coupling = Math.pow(decay, d - 1); // γ^{d-1}
      const w = (fa.weight ?? 1) * (fb.weight ?? 1);
      r = Math.max(r, w * coupling);
    }
  }
  return clamp01(r);
}

/**
 * Channel 3 — tree proximity (soft prior), eq. (6).
 */
function treeRisk(a, b) {
  const filesA = a.files || [];
  const filesB = b.files || [];
  let minDist = 1;
  for (const fa of filesA) {
    for (const fb of filesB) {
      minDist = Math.min(minDist, treeDistance(fa.path, fb.path));
    }
  }
  return clamp01(1 - minDist);
}

/**
 * Collision risk R(a,b) ∈ [0,1] via the noisy-OR of channels, eq. (2).
 * Returns the risk, its dual distance, and the per-channel breakdown.
 */
function collisionRisk(a, b, graph = {}, options = {}) {
  const weights = { ...DEFAULTS.channelWeights, ...(options.channelWeights || {}) };
  const channels = {
    overlap: overlapRisk(a, b),
    dependency: dependencyRisk(a, b, graph, options),
    tree: treeRisk(a, b)
  };
  let product = 1;
  for (const key of Object.keys(channels)) {
    const w = clamp01(weights[key] ?? 0);
    product *= 1 - w * channels[key];
  }
  const risk = clamp01(1 - product);
  return { risk, distance: clamp01(1 - risk), channels };
}

/**
 * Right-of-way priority: the agent with more committed work and the earlier
 * start holds course; the other steers. Higher number = higher priority.
 */
function agentPriority(agent) {
  const progress = (agent.files || []).reduce((s, f) => s + (f.weight ?? 1), 0);
  const startedAt = agent.startedAt ? Date.parse(agent.startedAt) || 0 : 0;
  // Earlier start ⇒ larger right-of-way term (negative ms, so earlier = larger).
  return { progress, ageMs: startedAt ? Date.now() - startedAt : 0 };
}

/**
 * TCAS-style advisory between two agents given their collision risk.
 * Returns { level: 'clear'|'advisory'|'resolution', risk, transmit, steer, hold }.
 *   - advisory: both should transmit intent to each other.
 *   - resolution: `steer` is the agentId that must move; `hold` holds course.
 */
function advise(a, b, graph = {}, options = {}) {
  const thresholds = { ...DEFAULTS.thresholds, ...(options.thresholds || {}) };
  const { risk, channels, distance } = collisionRisk(a, b, graph, options);

  if (risk < thresholds.ta) {
    return { level: 'clear', risk, distance, channels, transmit: false, steer: null, hold: null };
  }

  const pa = agentPriority(a);
  const pb = agentPriority(b);
  // Right-of-way: more progress wins; tie → earlier start (greater age) wins;
  // final deterministic tiebreak on agentId so the maneuver is coordinated.
  let aHasPriority;
  if (pa.progress !== pb.progress) aHasPriority = pa.progress > pb.progress;
  else if (pa.ageMs !== pb.ageMs) aHasPriority = pa.ageMs > pb.ageMs;
  else aHasPriority = String(a.agentId) < String(b.agentId);

  const hold = aHasPriority ? a.agentId : b.agentId;
  const steer = aHasPriority ? b.agentId : a.agentId;

  if (risk < thresholds.ra) {
    // Traffic advisory: exchange intent, no one has to move yet.
    return { level: 'advisory', risk, distance, channels, transmit: true, steer: null, hold: null };
  }
  // Resolution advisory: the lower-priority agent steers away.
  return { level: 'resolution', risk, distance, channels, transmit: true, steer, hold };
}

/**
 * Closure rate: how fast two agents are converging, from two risk samples
 * Δt apart (TCAS uses closure rate, not just separation, to decide urgency).
 * Positive ⇒ approaching. Used to escalate before the protected zone is reached.
 */
function closureRate(prevRisk, currRisk, dtMs) {
  const dt = Number(dtMs) > 0 ? Number(dtMs) : 1;
  return (clamp01(currRisk) - clamp01(prevRisk)) / (dt / 1000);
}

module.exports = {
  DEFAULTS,
  treeDistance,
  lineRangeOverlap,
  graphDistance,
  overlapRisk,
  dependencyRisk,
  treeRisk,
  collisionRisk,
  agentPriority,
  advise,
  closureRate,
  _internal: { normalizePath, segments, jaccard }
};
