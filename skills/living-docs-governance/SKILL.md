---
name: living-docs-governance
description: "Keep a long-lived project's documentation from rotting by running it as a small system of role-specific governance files (constitution, map, status dashboard, append-only log) with a fixed session read order. Use in the maintain phase, after a project is up and running and docs start drifting from code or agents lose context between sessions. Complements one-time onboarding (codebase-onboarding); this is the ongoing discipline that keeps the picture true over months. 中文触发：文档治理、活文档、项目状态追踪、防文档漂移、项目地图、健康仪表盘、流水账、进会话读序、长期项目治理"
metadata:
  origin: ECC
---

# Living Docs Governance

Long-lived projects rot at the documentation layer first: the README lies, the architecture notes describe a refactor that never shipped, and every new session an agent re-derives context it should have been able to read. **Living Docs Governance** treats project documentation as a small, role-specific *system* rather than a pile of files: four interlinked documents, each with exactly one job, plus a fixed order an agent reads them in when it enters a session.

This is a **maintain-phase** practice. For the one-time "I just cloned an unfamiliar repo" problem, use `codebase-onboarding`. This skill is what keeps that onboarding picture *true* after months of change.

## When to Activate

Activate when any of these are true:

- A project has grown past a few modules and the docs are drifting from the code.
- An agent or teammate loses context between sessions and keeps re-discovering the same structure.
- Nobody can answer "what is the current health of this project?" or "what changed last week?" from a single place.
- Dead files and abandoned experiments pile up and occasionally get recreated by mistake.
- You want a durable, low-overhead governance layer for a solo or small-team project, without the heavy CI machinery a large multi-contributor repo would use.

Do **not** reach for this on a throwaway script or a repo that will not outlive the week.

## How It Works

The system is **four documents** with strictly separated roles, a **session read order**, and **update rules** that keep them current.

### The four documents and their jobs

| Document | One job | What goes in | What must NOT go in |
|---|---|---|---|
| `CLAUDE.md` | Constitution: the always-on hard rules and signposts | Non-negotiable conventions, the read order, pointers to the other docs | Long explanations (link out instead), live state, history |
| `CLAUDE_MAP.md` | Map: what exists and where to find it | Top-level structure, one-line role per directory/key file, a "to find X go here" jump table, dependency direction | Health metrics (belong in STATUS), event history (belongs in LOG) |
| `PROJECT_STATUS.md` | Health dashboard: the current state at a glance | Metrics vs thresholds, the delete-zone (files removed on purpose, not to be recreated), open violations, P0 actions | What the project *is* (belongs in MAP), the narrative of what happened (belongs in LOG) |
| `PROJECT_LOG.md` | Ledger: append-only history | One line per meaningful event (`[date] type \| summary`), newest appended at the bottom | Current state (belongs in STATUS), structure (belongs in MAP); never edit or delete past lines |

The discipline that makes it work is **non-overlap**: every fact lives in exactly one document. "Where is the auth module?" goes to the MAP. "Is coverage healthy right now?" goes to STATUS. "When did we delete the old parser and why?" goes to the LOG. When each document has one job, none of them rot together.

### The session read order

At the start of a session, read in this order:

1. `CLAUDE.md` for the rules to obey.
2. `CLAUDE_MAP.md` for where everything is.
3. `PROJECT_STATUS.md` for the current state and what is off-limits or scheduled for deletion.
4. `PROJECT_LOG.md` (tail) for what happened recently.

Four short reads reconstruct the full working context, instead of re-deriving it by grepping the tree every time.

### Update rules that keep it from rotting

- Change the structure (add or remove a module or top-level directory) -> update `CLAUDE_MAP.md` in the same change.
- A metric crosses a threshold, or you intentionally delete a file -> update `PROJECT_STATUS.md`, and add the path to the delete-zone so it is not recreated.
- Anything meaningful happens (commit, fix, refactor, cleanup, audit) -> append one line to `PROJECT_LOG.md`.
- Keep `CLAUDE.md` short: if it grows past a page, move detail into the doc that owns it and leave a signpost.

## Document Templates

Drop these at the project root and fill the bracketed parts.

`CLAUDE.md` (constitution; keep it short and link out for detail):

| Section | Contents |
|---|---|
| Read order | `CLAUDE.md` -> `CLAUDE_MAP.md` -> `PROJECT_STATUS.md` -> `PROJECT_LOG.md` (tail) |
| Hard rules | The few non-negotiable conventions (naming, imports, no new files) |
| Signposts | One line each pointing to where detail lives (specs, governance, status) |

Keep it under a page; when a section grows, move the detail into the document that owns it.

`CLAUDE_MAP.md`:

| Path | One line | Who touches it |
|---|---|---|
| `src/` | main code | features |
| `docs/` | rules and specs | rule changes |

Plus a "find X -> go here" jump table and a per-module status table.

`PROJECT_STATUS.md`:

| Metric | Now | Threshold | State |
|---|---|---|---|
| main entrypoint LOC | - | <600 green / 600-800 amber / >800 red | - |
| test coverage | - | >80% green | - |

Plus a delete-zone table (path, why removed, date, replacement) and an open-violations / P0 list.

`PROJECT_LOG.md` (append-only):

| Field | Convention |
|---|---|
| Heading | `## [YYYY-MM-DD] type \| one line` |
| Types | init / commit / fix / refactor / cleanup / audit |
| Rule | Append only; never edit or delete past entries |

## Examples

- **Docs drifted from code:** A six-month-old data tool's README still describes the v1 pipeline. Adopt the four documents; the MAP now states the real module layout, STATUS flags the README as stale, and from then on every structure change updates the MAP in the same commit.
- **Agent keeps losing context:** Every session the agent re-greps to learn the layout. After adopting the read order, four short reads at session start reconstruct context and the agent stops rediscovering.
- **A deleted file keeps coming back:** A dead `legacy_parser.py` was removed twice and recreated twice. Logging it in the STATUS delete-zone, with the reason and the replacement, breaks the loop.
