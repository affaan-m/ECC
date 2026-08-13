# Documentation Governance Change-Impact Matrix

Use this matrix at stage closeout, or when the user asks to synchronize, organize, wrap up, or make the project ready for a new maintainer. Resolve each artifact by its role in `.governance/docs-map.json` or the repository's existing source of truth before using the reference filenames below.

Core discipline: `PROJECT_LOG.md` is append-only history. `CLAUDE_MAP.md`, `PROJECT_STATUS.md`, and `CLAUDE.md` represent current truth, so obsolete facts must be corrected, duplicates consolidated, and stale content removed.

## Code or Project Change → Governance Artifacts

| What changed | Must inspect or update |
|---|---|
| A top-level directory or core module was added, removed, or renamed | `CLAUDE_MAP.md` dependency direction and hard-to-find jump table; append the structural change to `PROJECT_LOG.md` |
| An entry point, command, script, or service port was added | `CLAUDE_MAP.md` entry-point table; README run instructions; append to `PROJECT_LOG.md` |
| The testing method changed | `PROJECT_STATUS.md` test-health metrics; `CLAUDE.md` verification rule only if it became a durable rule; append to `PROJECT_LOG.md` |
| A metric crossed a threshold (file size, coverage, missing tests, dependency risk) | `PROJECT_STATUS.md` metric and P0/P1 action; append an audit/fix event to `PROJECT_LOG.md` |
| A file was deliberately deleted, a module deprecated, or a backup directory cleaned | `PROJECT_STATUS.md` deletion zone with path, reason, date, and replacement; append a cleanup event to `PROJECT_LOG.md` |
| A durable rule, coding constraint, or non-negotiable process was added | `CLAUDE.md`; link to detailed docs when needed; append a governance event to `PROJECT_LOG.md` |
| README, docs, and code structure contradict one another | Correct the file that owns current truth; do not explain the mismatch only in LOG; optionally append an audit/fix event |
| An environment variable, secret setting, or deployment parameter was added | A pointer in `CLAUDE.md` or README; `PROJECT_STATUS.md` risk entry when relevant; append to `PROJECT_LOG.md` |
| A business flow, user journey, page, or view was added | A “find X here” pointer in `CLAUDE_MAP.md`; README demo/run instructions when user-facing; append to `PROJECT_LOG.md` |
| An API, route, or frontend/backend field changed | `CONTRACT.md` if present; frontend entry, API wrapper, and backend route locations in `CLAUDE_MAP.md`; append a contract event to `PROJECT_LOG.md` |
| An interface was added but no `CONTRACT.md` exists | Recommend creating `CONTRACT.md`; do not put field-level details in `CLAUDE_MAP.md` |
| Domain terminology, concept relationships, or adopted interpretation changed | `CONTEXT.md` if enabled; list unconfirmed evidence as needing confirmation and do not change code semantics |
| A hard-to-reverse architecture, database, authentication, deployment, data-model, or API-version decision changed | Create or update the relevant ADR with `architecture-decision-records`; keep MAP as an index pointer only; append a decision event to LOG |
| Success criteria, a requirement, or a bug changed | Keep the original Spec/Issue as the single source; link TEST-ID or manual-exit evidence in `TESTS.md`; do not copy the criteria |
| Module behavior or downstream dependencies changed | `REGRESSION.md` downstream list and executable commands; associated TEST-IDs; run the changed module and downstream consumers after implementation |
| A data migration, breaking interface, or high-risk release is planned | Compatibility period, migration/recovery/rollback, and irreversible effects in the change-impact report; ADR/CONTRACT when applicable |
| Task ownership, blockers, or schedule changed | Issue Tracker; update STATUS only when project health changes, and never store scheduling in the LOG index database |

## Documentation Spine Responsibility Check

| Artifact | Closeout question |
|---|---|
| `CLAUDE.md` | Did this change introduce a durable hard rule? Should any detail move to MAP, STATUS, or LOG? |
| `CLAUDE_MAP.md` | Can a newcomer find entry points, modules, tests, and critical files? Do all paths exist? |
| `PROJECT_STATUS.md` | Do current risks, health metrics, and the deletion zone reflect measured reality? |
| `PROJECT_LOG.md` | Was each meaningful event appended? Were old history entries left untouched? |
| `CONTRACT.md` | Are frontend/backend fields, types, enums, and error codes defined only once? |
| `CONTEXT.md` (optional) | Does it contain only stable domain language supported by code, contract, or business evidence? |
| ADR set (optional) | Is each hard-to-reverse decision isolated, correctly indexed, and explicit about reversibility? |
| `TESTS.md` (optional) | Do success criteria link back to Spec/Issue, with verification evidence linked to TEST-IDs? |
| `REGRESSION.md` (optional) | Do affected modules and downstream consumers have executable commands, and were they run? |

## Closeout Synchronization Flow

1. Inventory the change from the session context, `git status -s`, recently modified files, and user-confirmed outcomes.
2. Use the matrix above to identify artifacts that should change.
3. Classify each governance artifact as synchronized, needs update, or needs user confirmation.
4. Update current truth when evidence is sufficient. Put uncertain items in the delivery summary under `Needs confirmation`.
5. Put intentionally deleted or deprecated items in the deletion zone of `PROJECT_STATUS.md` so a later agent does not recreate them.
6. Append `PROJECT_LOG.md` last, recording the stage outcome or this synchronization event.
7. If a change-impact analysis exists, reconcile it against the actual diff and report out-of-scope changes, unverified items, and temporary compatibility logic.

## Do Not

- Do not append everything to `CLAUDE.md`; it contains only hard rules and pointers.
- Do not put interface fields in `CLAUDE_MAP.md`; field contracts belong in `CONTRACT.md`.
- Do not use `PROJECT_LOG.md` instead of correcting current truth; LOG explains history only.
- Do not invent unmeasured metrics for completeness.
- Do not move schedules or task state into STATUS, LOG, or SQLite; preserve the project's existing Issue Tracker.
