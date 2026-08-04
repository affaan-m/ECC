# Legacy Artifact Inventory

This inventory keeps legacy and stale-work cleanup from becoming implicit. Each
artifact should be classified as landed, milestone-tracked, salvage branch, or
archive/no-action before release work treats the queue as clean.

## Classification States

| State | Meaning |
| --- | --- |
| Landed | Useful work has already been ported to current `main` and verified. |
| Milestone-tracked | Useful work remains, but belongs to a named roadmap milestone. |
| Salvage branch | Useful work should be ported through a fresh maintainer branch with attribution. |
| Translator/manual review | Content may be useful, but cannot be safely imported automatically. |
| Archive/no-action | Artifact is intentionally retained or skipped; no active port is planned. |

## Current Repository Scan

As of 2026-05-12, the tracked repo has no `_legacy-documents-*` directories.

Fresh check:

```sh
find . -type d -name '_legacy-documents-*' -print
```

Expected result: no output.

The only tracked legacy directory currently found by filename scan is
`legacy-command-shims/`.

The umbrella ECC workspace also contains sibling legacy git repositories outside
this tracked checkout. These are intentionally inventoried separately because
they can contain raw operator context, local settings, private drafts, or
untracked files that should not be copied into the public repo wholesale.

Fresh workspace-level check from the ECC umbrella directory:

```sh
find .. -maxdepth 1 -type d -name '_legacy-documents-*' -print | sort
```

Expected result:

```text
../_legacy-documents-ecc-context-2026-04-30
../_legacy-documents-ecc-everything-claude-code-2026-04-30
```

## Inventory

| Artifact | State | Evidence | Action |
| --- | --- | --- | --- |
| `_legacy-documents-*` directories | Archive/no-action | No matching directories exist in the tracked checkout as of 2026-05-12. | Re-run the scan before release. If any appear, add each directory to this table before publishing. |
| `legacy-command-shims/` | Archive/no-action | `legacy-command-shims/README.md` states these retired short-name shims are opt-in and no longer loaded by the default plugin command surface. | Keep as an explicit compatibility archive. Do not move these back into the default plugin surface without a migration decision. |
| Closed-stale PR salvage ledger | Landed | `docs/stale-pr-salvage-ledger.md` records useful stale work recovered through maintainer PRs. | Continue using the ledger pattern for future stale closures. |
| #1687 zh-CN localization tail | Translator/manual review | Large safe subsets landed in #1746-#1752; remaining pieces are attached to Linear ITO-55 for language-owner review. | Do not blindly cherry-pick. Split by docs, commands, agents, and skills if a translator review lane opens; no automatic import remains release-blocking. |
| #1609 Persian README translation | Translator/manual review | Recorded in the stale salvage ledger and attached to Linear ITO-55 for language-owner review. | Do not import stale README/version/count text without a Persian reviewer and a current catalog refresh. |
| #1563 zh-TW README sync | Translator/manual review | Recorded in the stale salvage ledger and attached to Linear ITO-55 for language-owner review. | Do not import stale README/version/count text without a zh-TW reviewer and a current catalog refresh. |
| #1564 Turkish README sync | Translator/manual review | Recorded in the stale salvage ledger and attached to Linear ITO-55 for language-owner review. | Do not import stale README/version/count text without a Turkish reviewer and a current catalog refresh. |
| #1565 pt-BR README sync | Translator/manual review | Recorded in the stale salvage ledger and attached to Linear ITO-55 for language-owner review. | Do not import stale README/version/count text without a pt-BR reviewer and a current catalog refresh. |

## Workspace-Level Legacy Repos

These sibling repositories live outside the tracked `everything-claude-code`
checkout. They are source material for future salvage passes, not installable
release assets.

| Artifact | State | Evidence | Action |
| --- | --- | --- | --- |
| `../_legacy-documents-ecc-everything-claude-code-2026-04-30` | Archive/no-action | Separate legacy checkout on `fix/configure-ecc-skill-copy-paths-1483` at `b78ddbd0`; useful configure-ecc and install-path concepts have been superseded by current install docs and tests. The checkout also has untracked localized project-guidelines examples and a Finder duplicate `skills/social-graph-ranker/SKILL 2.md`. | Do not import wholesale. If configure-ecc copy-root regressions reappear, use this branch only as source-attributed archaeology and port through a fresh maintainer branch. Leave Finder duplicates out of source control. |
| `../_legacy-documents-ecc-context-2026-04-30` | Milestone-tracked | Archived `ECC-context` repo is four commits ahead of its origin and contains context, gameplan, knowledge, marketing, AgentShield, and ECC Tools planning material. It also contains local/private surfaces such as `.env` and local settings. | Keep as a sanitized extraction source for roadmap, launch, AgentShield, and ECC Tools work. Never copy raw context, secrets, personal paths, private settings, or unpublished drafts into this repo. Port only focused, public-safe content with attribution. |

## Workspace Legacy Import Rules

When mining workspace-level legacy repos:

1. Do not read, print, stage, or copy `.env` files, tokens, OAuth secrets,
   local settings, personal paths, or private operator context.
2. Do not import raw marketing drafts, gameplans, or chat/context dumps.
3. Extract only focused, public-safe ideas into current docs or code.
4. Attribute the source legacy repo, branch, commit, or stale PR in the new PR.
5. Validate the result with the same tests and release checks as native work.

## Legacy Command Shim Contents

The compatibility archive currently contains 12 retired command shims:

| Shim | Preferred current direction |
| --- | --- |
| `agent-sort.md` | Use maintained command or skill routing where available. |
| `claw.md` | Use maintained `scripts/claw.js` / `npm run claw` surfaces. |
| `context-budget.md` | Use maintained token/context budgeting skills. |
| `devfleet.md` | Use maintained agent/harness orchestration docs and skills. |
| `docs.md` | Use current documentation and release checklist workflows. |
| `e2e.md` | Use maintained E2E testing skills and test scripts. |
| `eval.md` | Use eval-harness and verification-loop skills. |
| `orchestrate.md` | Use maintained orchestration status and worktree scripts. |
| `prompt-optimize.md` | Use prompt-optimizer skill. |
| `rules-distill.md` | Use current rules and skill extraction workflows. |
| `tdd.md` | Use tdd-workflow and language-specific testing skills. |
| `verify.md` | Use verification-loop and package-specific verification skills. |

## Release Rule

Before any GA or rc publication pass:

1. Re-run the `_legacy-documents-*` scan.
2. Re-run the closed-stale salvage ledger check.
3. Confirm every newly discovered legacy artifact is represented in this file.
4. Port useful work through fresh maintainer PRs with source attribution.
5. Leave archive/no-action artifacts out of default install and plugin loading.
