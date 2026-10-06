# Agent-space distance metric & collision avoidance (Layer 4)

> Status: v0 implemented in `scripts/lib/agent-proximity/`. This is the moat
> layer of ECC 2.0 — *spatial deconfliction for multiple agents (and humans)
> working the same codebase*, modeled on aircraft collision avoidance (TCAS).

## The analogy

Two aircraft sharing airspace don't wait until they touch — TCAS continuously
measures their separation and closure rate, issues a **Traffic Advisory** ("there
is traffic near you") and then a coordinated **Resolution Advisory** ("you climb,
the other descends"). We want the same for agents: a continuous notion of *how
close two agents are in code-space*, so that as they approach we fire a trigger
that makes them **transmit what they're doing** to each other and, if needed,
makes one **steer away** — before they collide at the git/merge layer.

## 1. Agent state

At time *t*, agent *a* has a **working set**

```
W_a = { (f, R_f, w_f) }                                              (1)
```

where *f* is a touched file, *R_f* the set of edited line ranges in *f*, and
*w_f ∈ (0,1]* a recency weight (older edits decay toward a floor). An agent may
also declare an **intent set** *I_a* of files it is about to touch (look-ahead).

## 2. Collision is multi-channel (noisy-OR)

Two agents can collide through several independent channels. Each channel *i*
yields a collision probability *r_i ∈ [0,1]*; we combine them as the probability
of colliding through **at least one** channel:

```
R(a,b) = 1 − Π_i ( 1 − ω_i · r_i )                                   (2)
```

with channel weights *ω_i ∈ [0,1]*. The reported **distance** is the dual
*D(a,b) = 1 − R(a,b)*.

### Channel 1 — edit overlap *r_overlap*

For shared files *S = files(W_a) ∩ files(W_b)*:

```
lineOverlap(f) = |R_f^a ∩ R_f^b| / min(|R_f^a|, |R_f^b|)   (overlap coefficient)
r_overlap = max_{f∈S} w_f^a·w_f^b · lineOverlap(f)                        (3)
```

The overlap coefficient (not Jaccard) is the right measure: it stays high when one
agent's small edit sits inside the other's large region (Jaccard would dilute it by
union size). A whole-file edit (no line info) ⇒ `lineOverlap = 1`. Same file,
overlapping lines ⇒ imminent collision; same file, *disjoint* line ranges (different
functions) ⇒ low `r_overlap`. Different files ⇒ no shared `f` ⇒ `r_overlap = 0`.

### Channel 2 — dependency coupling *r_dep*

Build a dependency graph *G=(V,E)*, edge *f→g* iff *f* imports *g*. Even when two
files sit in distant subtrees, if one agent edits a file the other imports, the
edit breaks the importer. Coupling decays with (direction-agnostic) graph
distance *d_G*:

```
coupling(f,g) = γ^{ d_G(f,g) − 1 }     γ ∈ (0,1), 0 if unreachable   (4)
r_dep = max_{f∈W_a, g∈W_b}  w_f · w_g · coupling(f,g)                (5)
```

A direct import (*d_G = 1*) ⇒ *coupling = 1*. This is the **"collision even when
far away"** term the metric must capture — a cross-file parameter/return
dependency that fails at a distance.

### Channel 3 — tree proximity *r_tree* (soft prior)

For two paths with lowest-common-ancestor depth *L*:

```
treeDistance(f,g) = ((depth_f − L) + (depth_g − L)) / (depth_f + depth_g)  (6)
r_tree = 1 − min_{f∈W_a, g∈W_b} treeDistance(f,g)
```

(0 = same file, 1 = disjoint roots.) Tree proximity alone rarely causes a
collision, so *ω_tree* is small — it nudges the metric, never dominates it.

### Future channels (same shape)

Call-graph distance (two functions near in the call stack), symbol-level
read/write hazard (a writes a symbol b reads), and test-coverage overlap all slot
in as additional *r_i* with their own weights — the noisy-OR (2) absorbs them
without changing the framework.

## 3. The TCAS protocol

Two thresholds carve a protected zone around *R*:

| Risk band | Advisory | Action |
|---|---|---|
| `R < τ_TA` | **Clear** | nothing |
| `τ_TA ≤ R < τ_RA` | **Traffic Advisory** | both agents **transmit intent** to each other (the scout handshake — "here is what I'm doing / did") |
| `R ≥ τ_RA` | **Resolution Advisory** | the **lower-priority** agent steers away; the other holds course |

The resolution is **coordinated and deterministic** (like one plane climbing while
the other descends) so the two agents never pick the same maneuver. Right-of-way
priority:

```
priority(a) = ( committed-work(a),  age(a) )      lexicographic
```

More committed work wins; ties break on earlier start; the final tiebreak is a
stable agent id. The lower-priority agent receives the steer.

**Closure rate.** TCAS escalates on *closing speed*, not just separation. From two
risk samples Δt apart, `closureRate = (R_t − R_{t−Δt}) / Δt`; a positive closure
rate near *τ_TA* can pre-emptively escalate before the protected zone is entered.

## 4. Vector-space view (the visualization)

Each file gets a coordinate via a **space-filling embedding of its path** (files
sharing a long directory prefix share most of their coordinate), then pulled
toward its dependency neighbours by one averaging step. An agent sits at the
recency-weighted centroid of its files' coordinates. The result: `‖v_a − v_b‖`
tracks the collision risk *R*, so a **3D "where are the agents" view** renders
agents as moving points in a file-cloud — you literally watch them crawl toward
each other, see the advisory line light up, and watch one steer away.

`scanAirspace(agents, graph)` returns, in one pass: the non-clear `advisories`
(what the trigger layer acts on), the 3D `positions` and `fileCoordinates` (what
the renderer draws), and pairwise `links` with risk (the edges to color).

## 5. How it wires into ECC

- **Inputs** come from the session/work state: each running session's worktree
  diff gives its working set *W_a*; the dependency graph is built from the repo
  (`buildDependencyGraph`).
- **Triggers**: the control-pane tick calls `scanAirspace`; a Traffic Advisory
  injects a "transmit intent" message between the two agents' sessions; a
  Resolution Advisory tells the lower-priority agent to steer (re-target to a
  different file/subtree) — the first concrete realization of *just-in-time
  multi-agent (and multi-human) deconfliction*.
- **Board**: advisories surface on the kanban as proximity warnings, extending
  the agent/human JIT assignment layer already in the control pane.

## Roadmap

- v0 (done): tree + overlap + dependency channels, noisy-OR risk, TCAS advisories,
  priority/steer, 3D embedding, full test coverage.
- v1: call-graph & symbol read/write channels; intent look-ahead; closure-rate
  escalation wired to live session diffs.
- v2: cross-machine airspace over Tailscale (teammate agents enter the same
  space); the recorded "N agents, M humans, zero merge conflicts" demo.

The control pane compares each worktree against the merge base of its declared base
and HEAD. Committed, staged, and unstaged tracked edits carry changed line ranges.
Untracked files that Git does not ignore participate as whole-file working sets.
Changes made only on the base branch after the worktree diverged do not participate.
