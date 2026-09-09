# ECC Roadmap

Status: draft for the maintainer to edit. Written 2026-09-02 against release
2.2.1. Dates are targets, not commitments. Numbers in brackets are the ones to
confirm or change.

The two older planning docs stay as evidence and history:
`docs/ECC-2.0-GA-ROADMAP.md` (2.0 milestones and control-plane deltas) and
`docs/ECC-PRO-SECURITY-ROADMAP.md` (AgentShield and Pro conversion). This file
is the short, current view.

## Vision

ECC is the operating layer between a developer and whatever coding agent they
run. One install, one set of skills, hooks, rules, and agents, working the same
way in Claude Code, Codex, OpenCode, Cursor, Gemini, and the rest. The bar for
everything that ships: simpler to read, faster to run, and traceable after the
fact, for agents and humans alike.

Three things follow from that.

1. **The repo is the product.** Curated skills, hooks, and rules are the
   surface people install. Anything that is not installed, tested, or read by
   someone should not be in the tree.
2. **Evidence over assertion.** A harness change earns trust through a gate
   receipt, a capsule, and a reproducible verdict, not through a paragraph
   saying it works. The eval-harness frameworks exist to make that cheap.
3. **Operator patterns travel.** Approval loops, channel discipline,
   agreement generation, and e-sign placement were built for one desk. As
   generic skills they are useful to anyone running agents next to
   counterparties, customers, or money.

## Where we are

- 2.2.1 shipped 2026-08-31 with guided manifest-driven setup, install-state
  ownership, repair and uninstall, and a signed release path.
- Catalog: [68] agents, [290] skills, [94] commands. The count is a liability
  as much as an asset. Overlapping and unreferenced skills exist.
- README is [2,200] lines with three install sections and a release-notes
  block that duplicates the changelog.
- Eval story: the `eval-harness` skill described a report format. The
  runnable layer (capsule journal, staged gate, replay fence, offline
  receipt) landed in September 2026 with a working example.
- AgentShield: steady free funnel, no bridge to a paid surface yet.

## Plan

### Track A: condense

Cut what nobody reads or installs. Merge what overlaps. One README that reads
top to bottom in one pass. Exit criteria: no zero-reference tracked doc
outside `docs/releases/`, no deprecated skill still shipped by default,
README under [1,200] lines with one install path per harness.

### Track B: evidence

Make the gate the default way a harness edit is judged. Wire the
`harness-optimizer` agent and `/harness-audit` to emit gate receipts. Add
capsule recording to the hooks that already log session activity. Then the
next two plan slices: offline retrospective grouping over capsules (no new
rollouts) and forced-compaction tests that prove pinned constraints survive.

### Track C: operator skills

Ship the four desk-pattern skills (operator approval loop, counterparty
channel discipline, master agreement generator with schedule append, e-sign
field placement) and collect the first outside user of each. Fold what they
report back into the skills before adding more.

### Track D: distribution and revenue

Keep the release path boring: tag on main, CI green at the exact head, packed
artifact tested on three platforms. Add the Pro conversion path AgentShield
lacks: a hosted scan history and a PR-comment autofix loop. Details and
scoring live in the security roadmap.

## Next 90 days

Window: 2026-09-02 to 2026-12-01.

### September

- Land the four PRs from the 2026-09-02 program: eval-harness frameworks,
  desk-pattern skills, condensation pass, this roadmap.
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
