# Documentation Artifact-Role Contract

This contract defines how the documentation-governance router and read-only
audit resolve project documentation. Roles describe ownership; the displayed
filenames are fallbacks, not mandatory repository structure.

## Role Registry

| Role | Default | Owns | Does not own |
|---|---|---|---|
| `constitution` | `CLAUDE.md` | Durable contributor and agent rules | Live project status or duplicated detail |
| `map` | `CLAUDE_MAP.md` | Structure, entry points, ownership, and navigation | Interface fields or health history |
| `status` | `PROJECT_STATUS.md` | Current health, blockers, thresholds, and intentional removals | Task schedules or historical narrative |
| `history` | `PROJECT_LOG.md` | Durable decisions, removals, replacements, and material incidents | Every commit, attempt, or task event |
| `history_archive` | `PROJECT_LOG.archive.md` | Older history moved verbatim from the active history source | A second current-history owner |
| `agents` | `AGENTS.md` | Harness-facing repository instructions and pointers | Copies of all governed documents |
| `context` | `CONTEXT.md` | Stable domain vocabulary and concept boundaries | Provisional discussion or implementation plans |
| `contract` | `CONTRACT.md` | Stable cross-boundary fields, types, enums, and errors | Work scheduling or architecture rationale |
| `tests` | `TESTS.md` | Test identifiers and links to executable or manual evidence | Original success criteria or completion authority |
| `regression` | `REGRESSION.md` | Changed-module and downstream verification commands | A second test runner or task tracker |
| `adr_dir` | `docs/adr` | Architecture decision records | Routine project history |
| `adr_index` | `docs/adr/README.md` | The canonical index for the mapped ADR directory | Decisions not represented by an ADR |

The Issue tracker owns task status, assignees, scheduling, attempts, and
acceptance decisions. A Spec or Issue owns its success criteria. Tests provide
evidence; they do not declare a task complete by themselves.

## Mapping File

Repositories may override defaults with `.governance/docs-map.json`:

```json
{
  "constitution": "AGENTS.md",
  "map": "docs/architecture.md",
  "status": "docs/roadmap.md",
  "history": "docs/decisions.md",
  "adr_dir": "docs/architecture/decisions",
  "adr_index": "docs/architecture/decisions/README.md"
}
```

Each value must be a non-empty repository-relative path that resolves inside
the repository root. Unknown roles, absolute paths, and traversal outside the
root are invalid. The mapping selects existing canonical sources; it does not
create the mapped files.

## Progressive Adoption

- Discover existing sources before introducing a mapping.
- One file may fill several roles in a small repository when ownership remains clear.
- Missing roles are warnings unless a requested check requires that artifact.
- Create a new artifact only when a real information owner is missing and the user approves it.
- Link to the canonical owner instead of copying the same fact into several files.

## Audit Contract

The bundled audit is deterministic and read-only. Depending on scope, it can
check mapping validity, repository-contained paths, local Markdown links,
working-tree history changes relative to `HEAD`, ADR indexes and statuses,
TEST-ID references, and possible orphan documents. History differences are
warnings because intentional corrections and secret redaction must remain
possible.

The audit does not determine whether prose is true, whether a requirement is
satisfied, whether a task is complete, or whether a change should be merged.
Warnings explicitly require semantic review.

For link checks, any `scheme://` destination is external. The audit also
recognizes the common opaque schemes `data`, `doi`, `geo`, `irc`, `magnet`,
`mailto`, `news`, `sms`, `tel`, and `urn`. Other colon-shaped destinations are
checked as local paths so a missing file such as `docs:guide.md` cannot silently
bypass validation.
