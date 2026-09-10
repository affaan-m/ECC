# ECC Roadmap

Status: maintainer planning draft, updated 2026-09-09 against the integrated
source candidate based on release 2.2.1. Source inclusion is not a release or live
verification claim. Dates are targets, not commitments; bracketed numbers remain
planning choices.

The two older planning docs stay as evidence and history:
`docs/ECC-2.0-GA-ROADMAP.md` (2.0 milestones and control-plane deltas) and
`docs/ECC-PRO-SECURITY-ROADMAP.md` (AgentShield and Pro conversion). This file
is the short, current view.

## Vision

ECC is the operating layer between a developer and whatever coding agent they
run. Shared skills, rules, and agent guidance provide portable core workflows
across Claude Code, Codex, OpenCode, Cursor, Gemini, and other harnesses.
Hooks, installation paths, and feature coverage vary by host; consult the
[support status matrix](../README.md#platform-support) for current limits.
The bar for everything that ships: simpler to read, faster to run, and
traceable after the fact, for agents and humans alike.

Three things follow from that.

1. **The repo is the product.** Curated skills, hooks, and rules are the
   surface people install. Anything that is not installed, tested, or read by
   someone should not be in the tree.
2. **Evidence over assertion.** A harness change earns trust through a gate
   receipt, a capsule, and a reproducible verdict, not through a paragraph
   saying it works. The offline eval framework provides the recording and review primitives;
   isolated candidate execution remains future work.
3. **Operator patterns travel.** Approval loops, channel discipline,
   agreement generation, and e-sign placement were built for one desk. As
   generic skills they are useful to anyone running agents next to
   counterparties, customers, or money.

## Where we are

- The 2.2.1 source baseline includes guided manifest-driven setup, install-state
  ownership, repair and uninstall. Its release workflow requires exact-head
  validation; this roadmap is not release-signature evidence.
- Catalog in this source snapshot: 68 agents, 289 skills, 94 legacy commands. The
  count is a liability as much as an asset. Overlapping and unreferenced
  skills exist.
- The README now has one primary install section, with per-harness details
  and release history linked to `CHANGELOG.md`. Further shortening is a target,
  not a completed claim.
- Eval source now includes capsule journals, replay matching and offline
  receipt inspection, plus a protocol example. Candidate execution and staged
  gate runs are disabled: no actual OS containment exists. Offline validation
  and a receipt signature do not establish safe execution or promotion authority.
- The README describes AgentShield scanning and the hosted ECC Pro surface.
  Further conversion and scan-history improvements below are proposals, not
  evidence of missing paid functionality or verified adoption.

## Plan

### Track A: condense

Cut what nobody reads or installs. Merge what overlaps. One README that reads
top to bottom in one pass. Exit criteria: no zero-reference tracked doc
outside `docs/releases/`, no deprecated skill still shipped by default,
README under [1,200] lines with one install path per harness.

### Track B: evidence

Implement and independently test an OS executor before enabling the gate:
contain child processes, filesystem and network access, scrub inherited
capabilities, enforce resource limits, and bind replay and result provenance.
Keep execution disabled until those boundaries are proven. Then wire the
`harness-optimizer` agent and `/harness-audit` to emit gate receipts. Add
capsule recording to the hooks that already log session activity. Then the
next two plan slices: offline retrospective grouping over capsules (no new
rollouts) and forced-compaction tests that prove pinned constraints survive.

### Track C: operator skills

The four desk-pattern skills are present in this candidate: operator approval
loop, counterparty channel discipline, master agreement drafting with bounded
schedule append, and e-sign field placement guidance. Validate each with its
actual consumer and collect outside feedback before adding more. Written send
and audience contracts do not claim transport enforcement; generated agreements
remain drafts and DOCX conversion does not establish execution readiness.

### Track D: distribution and revenue

Keep the release path boring: tag on main, CI green at the exact head, packed
artifact tested on three platforms. Improve the AgentShield-to-Pro conversion path, evaluating hosted scan history
and a PR-comment autofix loop against what the hosted product already supports. Details and
scoring live in the security roadmap.

## Next 90 days

Window: 2026-09-02 to 2026-12-01.

### September

- Review and release the composed 2026-09-02 program: offline eval frameworks,
  desk-pattern skills, condensation and this roadmap. The source candidate
  incorporates them; merge and release remain separate maintainer decisions.
- README linear pass merged. Release notes move to `CHANGELOG.md` only.
- Delete list from the condensation survey executed, with catalog counts,
  manifests, and locale mirrors updated in the same PR.
- Decide the fate of `continuous-learning` v1 (deprecated since April): remove
  in [2.3.0] with a migration note, or keep as an archive outside the default
  install.

### October

- `harness-optimizer` and `/harness-audit` produce gate receipts. A skill,
  hook, or agent change in this repo can cite a receipt in its PR.
- Capsule recording behind an opt-in hook flag, journaling tool calls and
  session boundaries with the default-deny payload allowlist.
- First taskset beyond the example: [20 to 60] tasks over one real skill
  family, with a held-out split and a reward-hack fixture.
- Skill catalog review: every skill has a test, a command, an agent, or a
  README mention, or it is marked for removal in [2.4.0].

### November

- 2.3.0: condensation, eval frameworks, and operator skills in one release
  with the packed-artifact gate.
- Retrospective grouping over recorded capsules for one task family, report
  only, no promotion.
- Forced-compaction invariance test in CI for the pinned-state pattern.
- AgentShield Pro conversion CTA and hosted scan history behind a flag.

### Decision points

- 2026-09-30: is the README under the line target with no test regressions?
  If not, cut scope on Track A rather than slipping the release.
- 2026-10-31: does a real taskset produce a stable verdict across three runs?
  If variance is high, hold Track B at receipts and do not start retrospective
  grouping.
- 2026-11-30: did any outside user adopt a desk-pattern skill? If none, stop
  adding operator skills and fold the four into a single guide.

## Not on this roadmap

- Online reinforcement learning or weight updates from capsule data.
- Production transparency-log witnessing, GPU attestation, or key management
  inside the ECC package.
- Automatic merge or release driven by a gate verdict. The gate stops changes.
  A person promotes them.
- Any desk, payment, provider, or counterparty integration. Those belong to
  the systems that own them, not to a portable plugin.

## How to edit this file

Change the bracketed numbers first. Move items between months freely. When a
line ships, delete it here and record it in `CHANGELOG.md`. Keep the file
under [200] lines.
