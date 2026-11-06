# Grok ECC Navigation Map

This guide helps Grok agents navigate ECC without scanning every surface from
scratch. Use it after the root `AGENTS.md` and `.grok/AGENTS.md` when planning
work, preparing a PR-quality diff, or handing context to a reviewer.

## Start Here

Read in this order:

1. `AGENTS.md` - universal project rules, agent routing, testing expectations,
   and commit workflow.
2. `.grok/AGENTS.md` - Grok-specific setup, MCP, skill discovery, and slash
   commands.
3. `docs/COMMAND-AGENT-MAP.md` - command to agent and skill routing.
4. This guide - repo navigation, diff packet shape, and PR review lanes for
   Grok sessions.

If those files disagree, prefer the more specific file for the current task:
Grok-specific behavior belongs in `.grok/AGENTS.md`; general contribution
policy belongs in `AGENTS.md` and `CONTRIBUTING.md`.

## Surface Map

| Surface | What It Owns | Grok Use |
|---------|--------------|----------|
| `AGENTS.md` | Cross-harness operating rules | Read before any repo work |
| `.grok/AGENTS.md` | Grok-only guidance | Read after root instructions |
| `~/.grok/config.toml` | Models, UI, MCP, plugins | Inspect when setup or MCP behavior matters |
| `.grok/agents/` | Grok markdown agent definitions | Use for explorer, reviewer, and docs researcher |
| `.agents/skills/` | Shared skill copies | Grok already scans this tree |
| `skills/` | Canonical skill source | Update first for new workflow knowledge |
| `agents/` | Claude-style subagent prompts | Source material, not Grok agent files |
| `commands/` | Legacy slash-command shims | Synced into `~/.grok/commands/` unprefixed unless a builtin or different skill conflicts |
| `docs/COMMAND-AGENT-MAP.md` | Command to agent and skill relationships | Check before renaming or adding workflow surfaces |
| `rules/` | Shared coding, security, and workflow rules | Read language or domain rules before implementation |
| `hooks/` | Claude Code hook workflows | Do not assume Grok hook parity |
| `scripts/` | Install, validation, sync, and CLI utilities | Follow existing Node script patterns |
| `manifests/` | Install component and module registration | Update when adding installable surfaces |
| `.github/PULL_REQUEST_TEMPLATE.md` | Required PR body checklist | Preserve sections when creating PRs |

## Task Routing

Use this quick routing before editing:

| Task | First Files | Likely Verification |
|------|-------------|---------------------|
| Add or update a skill | `skills/<name>/`, `.agents/skills/<name>/`, `manifests/` | `node scripts/ci/validate-skills.js` |
| Add or update a command | `commands/`, `docs/COMMAND-AGENT-MAP.md`, `COMMANDS-QUICK-REF.md` | `node scripts/ci/validate-commands.js`, `npm run command-registry:check` |
| Add a Grok setup change | `.grok/`, `scripts/grok/`, `scripts/sync-ecc-to-grok.sh` | `node tests/scripts/sync-ecc-to-grok.test.js` |
| Decide if the Grok overlay is still required | `scripts/lib/grok-fixture-upgrade.js`, `scripts/grok/check-grok-fixture.js` | `node scripts/grok/check-grok-fixture.js --json` |
| Add installable content | `manifests/`, `scripts/lib/install-*`, `package.json` | `node scripts/ci/validate-install-manifests.js`, targeted install tests |
| Add docs-only guidance | `docs/`, harness supplement files | Targeted docs test plus `markdownlint` if available |
| Review a PR | `commands/review-pr.md`, `agents/*reviewer.md` | Diff review plus relevant tests |

Keep workflow contributions skills-first. Add or update `commands/` only for
legacy slash-entry compatibility or cross-harness parity.

## Upgrade gate

`ecc auto-update` classifies a Grok copied-config overlay before `git pull`:

| Flow | When | What happens |
|------|------|----------------|
| perforated | Overlay still required, and incoming files would strip it without a Grok replacement | Snapshot overlay files, pull, restore exclusive files and any shared file that lost its Grok marker, then re-sync `~/.grok` if `config.toml` exists |
| solved | Incoming ECC has a `grok` install target or `.grok-plugin`, or it absorbed the copied-sync plus MCP harness | Pull as-is, write `~/.grok/ecc/fixture-policy.json` `detached`, and stop gating later upgrades |
| passthrough | Overlay still required, but this upgrade does not touch fixture paths | Pull as-is, keep the overlay, persist dest with a dest sync if `config.toml` exists |

Necessity is not "are our files still on disk". Probe incoming ECC:

1. `SUPPORTED_INSTALL_TARGETS` includes `grok`
2. `.grok-plugin/plugin.json` exists
3. `scripts/sync-ecc-to-grok.sh` plus `--harness grok` in the MCP merger

The overlay is necessary only while `~/.grok` still has a dest fixture and probes 1–2 are false. Inspect with `node scripts/grok/check-grok-fixture.js --json`.

## Grok Agent Roles

ECC ships project-local Grok agent definitions in `.grok/agents/`:

| Role | File | Use |
|------|------|-----|
| Explorer | `.grok/agents/explorer.md` | Read-only evidence gathering before edits |
| Reviewer | `.grok/agents/reviewer.md` | Correctness, security, and missing-test review |
| Docs researcher | `.grok/agents/docs-researcher.md` | API, release-note, and docs claim verification |

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
| Review a PR | `/review-pr` | Runs multi-perspective review lanes and aggregates findings |
| Review current changes before PR | `/ecc-code-review` | Prefixed because Grok ships a different bundled `code-review` skill |

When a slash command is not available, read the command file and perform the
same steps manually.

## Review Lanes

For a PR-quality diff, check these lanes before asking for review:

| Lane | Evidence |
|------|----------|
| Scope | `git diff origin/main...HEAD --name-only` matches the stated intent |
| Tests | New behavior has a targeted test or a clear no-test rationale |
| Security | No secrets, unsafe external writes, broad permissions, or input trust gaps |
| Install surface | New skills, commands, agents, hooks, scripts, or files are registered where required |
| Cross-harness | Grok, Codex, OpenCode, Cursor, Claude Code, and docs surfaces are updated only when applicable |
| Docs | README and focused docs link to the new source of truth |

For code changes, invoke the relevant reviewer lane after implementation. For
docs-only changes, run the targeted docs test and review links for drift.

## Common Navigation Pitfalls

- Do not treat `commands/` as the canonical place for new workflow knowledge.
  Prefer `skills/` first.
- Do not copy Codex `.toml` agent roles or Codex `config.toml` keys into
  `~/.grok`. Grok agents are Markdown; Grok MCP allows `url` transports.
- Do not assume Claude or Codex hook parity. Grok loads `~/.grok/hooks/*.json`.
- Do not copy skills into `~/.grok/skills/`. Sync installs from repo
  `.agents/skills/` into `~/.agents/skills/`.
- Do not leave a Grok docs change discoverable only through README prose. Link
  it from `.grok/AGENTS.md` when it affects Grok behavior.

## Fast Commands

Useful local checks:

```bash
node tests/docs/grok-navigation-map.test.js
node tests/scripts/sync-ecc-to-grok.test.js
npm run command-registry:check
npm run catalog:check
node tests/run-all.js
```
