# CLAUDE_MAP.md — Project Map

> Do not copy the directory tree here. Agents can derive files and folders from `ls` or glob without creating stale context. Record only facts that cannot be inferred reliably from the real tree and file headers.
>
> This file is not part of the default session read. Open it when something is hard to find, a change crosses modules, or before creating, deleting, or renaming files.

## 1. Dependency Direction

`main → ui → services → utils`; reverse dependencies are forbidden. `utils` must not depend on business layers, and `services` must not call `ui`.

> This is an architectural invariant that the file tree cannot reveal.

## 2. Hard-to-Find Locations

List only locations an agent would otherwise miss or choose incorrectly. Do not list paths that a simple glob reveals.

| Looking for | Go to | Why |
|---|---|---|
| Refund-rate calculation | `src/services/refund.py` | It is not under reporting and is easy to misplace |
| Global configuration entry | `config/settings.yaml` | It is not `.env` |
| Agent tool registration | `src/agent/tool_registry.py` | New tools must also be registered here |

When the project enables the corresponding artifact, link only its entry point here: domain language → `CONTEXT.md`; decisions → ADR index; interfaces → `CONTRACT.md`; test evidence → `TESTS.md`; downstream regression → `REGRESSION.md`; tasks and schedules → Issue Tracker. Do not enumerate every ADR, Issue, Spec, or task.

## 3. Misleading but Real Paths

| Path | Reality |
|---|---|
| `src/legacy/` | Deprecated code. Do not modify or use as a reference, even though it still runs. |
| `src/generated/` | Generated output. Do not edit by hand; modify the generator. |
| `src/api_v1/` | Retained only for legacy-client compatibility. New work belongs in `api_v2/`. |
| `samples/` | Example code, not production business logic. |

## 4. Ask Before Touching

- `src/billing/` — affects real charges; every change requires human review.
- Lockfiles and credential files — do not modify or commit unless explicitly authorized.
