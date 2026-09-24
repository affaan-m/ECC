# Agent-space proximity and advisory prototypes (Layer 4)

> Status: v0 proximity scoring exists in `scripts/lib/agent-proximity/`.
> A separate v1 shadow trail records bounded advisories and declared responses.
> Current scores and drawings have no calibrated conflict probability or live
> conflict-reduction result.

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

Several channels contribute bounded heuristic scores *r_i ∈ [0,1]*. The shipped
noisy-OR-shaped combination is:

```
R(a,b) = 1 − Π_i ( 1 − ω_i · r_i )                                   (2)
```

with channel weights *ω_i ∈ [0,1]*. The reported **distance score** is the dual
*D(a,b) = 1 − R(a,b)*. Correlated channels and unvalidated weights mean *R* is
not a calibrated probability, and *D* need not satisfy metric axioms.

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
recency-weighted centroid of its files' coordinates. The resulting **3D display**
illustrates path and dependency proximity. Its Euclidean separation has not
been shown to preserve the risk score or predict collisions.

`scanAirspace(agents, graph)` returns, in one pass: the non-clear `advisories`
(what the trigger layer acts on), the 3D `positions` and `fileCoordinates` (what
the renderer draws), and pairwise `links` with risk (the edges to color).

## 5. How it wires into ECC

- **Inputs** come from the session/work state: each running session's worktree
  diff gives its working set *W_a*; the dependency graph is built from the repo
  (`buildDependencyGraph`).
- **Triggers**: control-pane prototype code can derive messages from
  `scanAirspace`. Delivery, acknowledgement, scope authorization and actual
  conflict resolution are separate evidence. The shadow trail below calls no
  sink, hook or steer path.
- **Board**: advisories surface on the kanban as proximity warnings, extending
  the agent/human JIT assignment layer already in the control pane.

## Passive shadow receipt trail (v1)

`scripts/lib/agent-proximity/shadow-trail.js` accepts two supplied, versioned
observations with task/repository/base/scope identity, read/write path sets,
completeness and expiry. It computes a local advisory using the shipped
three-channel scorer. An exact write/write or write/read path overlap takes
precedence over a low score. Incomplete, expired, future or incomparable critical
observations produce `unknown`; an absent advisory means only that no advisory
was found **within the complete, comparable supplied scope and supplied dependency
graph**. The optional graph defaults to empty and may be supplied anew for
re-observation; a quiet advisory says nothing about unsupplied dependencies.

Call `createShadowTrail`, then `appendAcknowledgement` for both observed agents,
`appendScopeRevision` for one externally declared revision and its new footprint,
and `appendReobservation` with a fresh matching pair. `summarizeShadowTrail`
reports the latest scoped advisory, its own advisory-bound ACKs, separate
historical acknowledgers and `outcome: unadjudicated`. Both original observations
must still be current when the scope-change declaration is recorded.
`verifyShadowTrail` checks the bounded local receipt chain after JSON persistence.
Each receipt hash binds the trail ID, event ID, time, predecessor hash and
canonical payload. The verifier rejects noncanonical persisted payload field
and path order before comparing hashes. Append results copy earlier receipts,
so changing an earlier returned object cannot change a later returned trail.
Returned data can still be mutated; verification detects inconsistent local
content. A party able to
rewrite and rehash the entire trail can forge a consistent chain. These hashes
do not establish trusted identity, permission, delivery, whole-log immutability
or an independently verified result.

The module issues no grants and sends no messages. The scope-change receipt's
`authorizationRef` is a caller declaration and is labelled `declared-only`;
the actual authority owner must validate it before any real work changes. It
records path metadata locally, so a caller must apply its own publication policy.
It accepts no memory summary or required-state payload. Approximate summaries
belong to the separately owned memory envelope; exact task constraints and
authority remain outside this heuristic score. The trail is limited to one
two-agent change, so it cannot grant coherent ownership across a three-agent
conflict component.

## Roadmap

- v0 (source present): tree + overlap + dependency channels, noisy-OR-shaped
  risk score, advisory/priority prototype and display embedding.
- v1 shadow (source present): passive two-agent observation/advisory/ACK/scope
  revision/re-observation receipts; no active steering or measured benefit.
- v1: call-graph & symbol read/write channels; intent look-ahead; closure-rate
  escalation wired to live session diffs.
- v2: cross-machine airspace over Tailscale (teammate agents enter the same
  space); the recorded "N agents, M humans, zero merge conflicts" demo.
