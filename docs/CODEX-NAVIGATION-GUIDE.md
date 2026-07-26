# Codex ECC Navigation Map

This guide helps Codex agents navigate ECC without scanning every surface from
scratch. Use it after the root `AGENTS.md` and `.codex/AGENTS.md` when planning
work, preparing a PR-quality diff, or handing context to a reviewer.

## Start Here

Read in this order:

1. `AGENTS.md` - universal project rules, agent routing, testing expectations,
   and commit workflow.
2. `.codex/AGENTS.md` - Codex-specific setup, MCP, skill discovery, and
   hook-parity limits.
3. `docs/COMMAND-AGENT-MAP.md` - command to agent and skill routing.
4. This guide - repo navigation, diff packet shape, and PR review lanes for
   Codex sessions.

If those files disagree, prefer the more specific file for the current task:
Codex-specific behavior belongs in `.codex/AGENTS.md`; general contribution
policy belongs in `AGENTS.md` and `CONTRIBUTING.md`.

## Surface Map

| Surface | What It Owns | Codex Use |
|---------|---------------|-----------|
| `AGENTS.md` | Cross-harness operating rules | Read before any repo work |
| `.codex/AGENTS.md` | Codex-only guidance | Read after root instructions |
| `.codex/config.toml` | Codex sandbox, MCP, profiles, agent roles | Inspect when setup or MCP behavior matters |
| `.codex/agents/` | Codex multi-agent role layers | Use for explorer, reviewer, and docs researcher roles |
| `.agents/skills/` | Codex-facing skill copies | Use when Codex needs native skill loading |
| `skills/` | Canonical skill source | Update first for new workflow knowledge |
| `agents/` | Claude-style subagent prompts | Use as source material for review lanes and delegation intent |
| `commands/` | Legacy slash-command shims | Update only when command compatibility is needed |
| `docs/COMMAND-AGENT-MAP.md` | Command to agent and skill relationships | Check before renaming or adding workflow surfaces |
| `rules/` | Shared coding, security, and workflow rules | Read language or domain rules before implementation |
| `hooks/` | Claude Code hook workflows | Do not assume Codex hook parity |
| `scripts/` | Install, validation, sync, and CLI utilities | Follow existing Node script patterns |
| `manifests/` | Install component and module registration | Update when adding installable surfaces |
| `.github/PULL_REQUEST_TEMPLATE.md` | Required PR body checklist | Preserve sections when creating PRs |

## Task Routing

Use this quick routing before editing:

| Task | First Files | Likely Verification |
|------|-------------|---------------------|
| Add or update a skill | `skills/<name>/`, `.agents/skills/<name>/`, `manifests/`, `agent.yaml` | `node scripts/ci/validate-skills.js`, `node tests/ci/codex-skill-surface.test.js` |
| Add or update a command | `commands/`, `docs/COMMAND-AGENT-MAP.md`, `COMMANDS-QUICK-REF.md` | `node scripts/ci/validate-commands.js`, `npm run command-registry:check` |
| Add a Codex setup change | `.codex/`, `scripts/codex/`, `scripts/lib/install-targets/codex-home.js` | `node tests/scripts/codex-hooks.test.js`, `node tests/codex-config.test.js` |
| Add installable content | `manifests/`, `scripts/lib/install-*`, `package.json` | `node scripts/ci/validate-install-manifests.js`, targeted install tests |
| Add docs-only guidance | `docs/`, `README.md`, harness supplement files | Targeted docs test plus `markdownlint` if available |
| Review a PR | `commands/review-pr.md`, `agents/*reviewer.md`, `agents/pr-test-analyzer.md` | Diff review plus relevant tests |

Keep workflow contributions skills-first. Add or update `commands/` only for
legacy slash-entry compatibility or cross-harness parity.

## Codex Agent Roles

ECC ships project-local Codex role layers in `.codex/agents/`:

| Role | File | Use |
|------|------|-----|
| Explorer | `.codex/agents/explorer.toml` | Read-only evidence gathering before edits |
| Reviewer | `.codex/agents/reviewer.toml` | Correctness, security, and missing-test review |
| Docs researcher | `.codex/agents/docs-researcher.toml` | API, release-note, and docs claim verification |

Use roles for bounded sidecar work. Do the immediate blocking task locally, and
delegate independent evidence or review tasks when they can run in parallel.

## PR Diff Packet

Before `/pr`, prepare a local diff packet. This gives reviewers the context
that many PR tools otherwise have to reconstruct.

Run:

```bash
git fetch origin
git diff origin/main...HEAD --stat
git diff origin/main...HEAD --name-only
git log origin/main..HEAD --oneline --reverse
```

Then capture:

```markdown
## PR Diff Packet

### Intent
<One sentence describing the user-visible or maintainer-visible outcome.>

### Diff Map
- Added: <new files and why they exist>
- Modified: <existing files and why they changed>
- Unchanged but relevant: <surfaces checked and intentionally left alone>

### Risk and review lanes
- Behavior:
- Security:
- Tests:
- Docs:
- Release/install surface:

### Testing Done
- <commands run, or "Not run" with reason>

### Follow-ups
- <optional, only if not required for this PR>
```

Use `.github/PULL_REQUEST_TEMPLATE.md` as the final PR body structure. The diff
packet feeds that template; it does not replace it.

## PR Commands

| Need | Command Surface | Notes |
|------|-----------------|-------|
| Create a PR | `/pr` | Discovers PR template, analyzes commits and files, pushes, and creates a PR |
| Create a PR from PRP workflow | `/prp-pr` | Same core flow with PRP artifact references |
| Review a PR | `/review-pr` | Runs multi-perspective review lanes and aggregates findings |
| Review current changes before PR | `/code-review` | Use before committing when no GitHub PR exists yet |

Codex may not execute slash commands natively in every environment. When a
slash command is not available, read the command file and perform the same
steps manually.

## Review Lanes

For a PR-quality diff, check these lanes before asking for review:

| Lane | Evidence |
|------|----------|
| Scope | `git diff origin/main...HEAD --name-only` matches the stated intent |
| Tests | New behavior has a targeted test or a clear no-test rationale |
| Security | No secrets, unsafe external writes, broad permissions, or input trust gaps |
| Install surface | New skills, commands, agents, hooks, scripts, or files are registered where required |
| Cross-harness | Codex, OpenCode, Cursor, Claude Code, and docs surfaces are updated only when applicable |
| Docs | README and focused docs link to the new source of truth |

For code changes, invoke the relevant reviewer lane after implementation. For
docs-only changes, run the targeted docs test and review links for drift.

## Common Navigation Pitfalls

- Do not treat `commands/` as the canonical place for new workflow knowledge.
  Prefer `skills/` first.
- Do not copy Claude hook claims into Codex docs. Codex enforcement is based on
  instructions, sandbox settings, and optional MCP config.
- Do not update `.agents/skills/` without checking the canonical `skills/`
  source and Codex `agents/openai.yaml` metadata expectations.
- Do not open broad PRs that mix unrelated skill, command, install, and release
  changes unless the user explicitly wants a release bundle.
- Do not leave a Codex docs change discoverable only through README prose. Link
  it from `.codex/AGENTS.md` when it affects Codex behavior.

## Fast Commands

Useful local checks:

```bash
node tests/docs/codex-navigation-map.test.js
node tests/ci/codex-skill-surface.test.js
npm run command-registry:check
npm run catalog:check
node tests/run-all.js
```
