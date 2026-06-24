# Progress Sync Contract

ECC 2.0 tracks execution state across GitHub, Linear, local handoffs, and the
repo roadmap. This contract defines the minimum evidence required before a
status update can claim a lane is current.

## Sources Of Truth

| Surface | Role | Current rule |
| --- | --- | --- |
| GitHub PRs/issues/discussions | Public queue and review state | Recheck live counts before every significant merge batch and before release approval. |
| Linear project | Executive roadmap and stakeholder status update | Use project documents and project/issue comments because project status updates are disabled in this workspace; create/reuse issues for durable execution lanes. |
| Local handoff | Durable operator continuity | Update the active handoff after every merge batch, queue drain, skipped release gate, or blocked external action. |
| Repo roadmap | Auditable planning mirror | Keep `docs/ECC-2.0-GA-ROADMAP.md` aligned to merged PR evidence and unresolved gates. |
| `scripts/work-items.js` | Local tracker bridge | Sync GitHub PRs/issues into the SQLite work-items store for status snapshots and blocked follow-up. |

## Flow Lanes

The repo mirror uses these flow lanes so ECC work does not collapse into one
undifferentiated backlog:

- Queue hygiene and stale-work salvage
- Release, naming, plugin publication, and announcements
- Harness adapter compliance
- Local observability, HUD/status, and session control
- Evaluator/RAG and self-improving harness loops
- AgentShield enterprise security platform
- ECC Tools billing, PR-risk checks, deep analysis, and Linear sync
- Legacy artifact audit and translator/manual-review tails

Each flow lane needs one owner artifact, one current evidence source, and one
next action. A lane is not current if any of those three fields are missing.

## Significant Merge Batch Update

After a significant merge batch, update Linear and the handoff with:

1. Current public queue counts for tracked GitHub repos.
2. Merged PR numbers, commit IDs, and validation evidence.
3. Changed release gates, if any.
4. Deferred or skipped work and the explicit reason.
5. The next one or two implementation slices.

When Linear project status updates are unavailable, use a project document plus
project/issue comments instead of creating placeholder issues. Issue capacity is
available for durable execution lanes, but do not use that issue capacity as a
substitute for evidence-backed project status. Create or reuse exact-title
issues only when the lane needs a durable execution owner, and link those issues
to repo evidence.

## Realtime Boundary

The local realtime path is file-backed by default:

- `node scripts/work-items.js sync-github --repo <owner/repo>` imports current
  GitHub PR and issue state into the SQLite work-items store.
- `node scripts/status.js --json` and `node scripts/work-items.js list --json`
  expose local state for a HUD, handoff, or later Linear sync.
- Linear remains the external status surface; the repo does not require hosted
  telemetry to be release-ready.

Hosted telemetry such as PostHog can be added later, but it must consume the
same event model rather than becoming a second source of truth.

## Release Gate

Do not publish, tag, announce, submit marketplace packages, or claim plugin
availability from this contract alone. Release readiness still requires the
publication-readiness evidence documents, fresh queue checks, package checks,
plugin checks, and explicit maintainer approval.
