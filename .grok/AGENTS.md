# ECC for Grok Build

This supplements the root `AGENTS.md` with Grok-specific guidance.

For repo navigation, surface ownership, and PR diff packet guidance, read
`docs/GROK-NAVIGATION-GUIDE.md` after this supplement.

## Model Recommendations

| Task Type | Recommended Model |
|-----------|------------------|
| Routine coding, tests, formatting | grok-4.6 |
| Complex features, architecture | grok-4.6 |
| Debugging, refactoring | grok-4.6 |
| Security review | grok-4.6 |

## Skills Discovery

Grok loads skills from several locations. This sync copies ECC skill packages
from the repo source `.agents/skills/` into the user destination
`~/.agents/skills/`. Other discovery paths:

- `.agents/skills/` — repo source for this sync; Grok also scans it in-project
- `~/.agents/skills/` — installed user destination (this sync's install target)
- `~/.grok/skills/` — extra user-scoped Grok skills
- `./.grok/skills/` and `<repo>/.grok/skills/` — project Grok skills
- `~/.claude/skills/` and `~/.cursor/skills/` when compatibility is enabled

Each skill is a directory containing `SKILL.md`. Do not copy skills into
`~/.grok/skills/` from this sync script.

Available skills include tdd-workflow, security-review, coding-standards,
frontend-patterns, backend-patterns, e2e-testing, eval-harness,
verification-loop, api-design, and the research / writing / investor set.

## Slash Commands

ECC command markdown is synced into `~/.grok/commands/` using the unprefixed
command stem (`/tdd`, `/aside`) unless a Grok builtin or a different
preexisting skill already owns that name. Conflicting names are installed as
`/ecc-<name>` (for example `/ecc-plan` next to Grok's builtin `/plan`).
Prefer the matching skill when both exist.

## MCP Servers

Grok reads MCP servers from `~/.grok/config.toml` under `[mcp_servers.<name>]`.
Unlike Codex, Grok accepts both stdio (`command` / `args`) and remote HTTP/SSE
(`url`) transports. Do not "repair" a user-managed `url` entry into stdio.

The sync script uses the shared ECC MCP merger in add-only mode. The current
default connector is Chrome DevTools. Heavier servers stay opt-in.

## Custom Agents

Grok agent definitions are Markdown files with YAML frontmatter in
`~/.grok/agents/` (user) or `.grok/agents/` (project). They are not Codex
`.toml` role layers.

Sample ECC roles shipped by this sync:

- `explorer` — read-only evidence gathering
- `reviewer` — correctness, security, and missing-test review
- `docs-researcher` — API, release-note, and docs claim verification

Spawn them with `spawn_subagent` using `subagent_type` set to the file stem.

## Home Rules

Grok always loads `$GROK_HOME/rules/*.md` and `$GROK_HOME/AGENTS.md`. Keep
language-specific rule packs as opt-in slash commands unless the user asked
for always-on home rules.

## Key Differences from Claude Code and Codex

| Feature | Claude Code | Codex CLI | Grok Build |
|---------|-------------|-----------|------------|
| Home instructions | `~/.claude` CLAUDE.md | `~/.codex/AGENTS.md` | `~/.grok/AGENTS.md` and `~/.grok/rules/` |
| Skills | `~/.claude/skills/` | `.agents/skills/` | `~/.grok/skills/` plus `.agents/skills/` |
| Commands | `~/.claude/commands/` | `~/.codex/prompts/` | `~/.grok/commands/` |
| Agents | Markdown subagents | `.toml` role layers | Markdown agents in `~/.grok/agents/` |
| MCP | `.mcp.json` | stdio-only `config.toml` | stdio and HTTP/SSE in `config.toml` |
| Hooks | settings.json matchers | narrower native subset | `~/.grok/hooks/*.json` plus config.toml |

## Security

1. Always validate inputs at system boundaries
2. Never hardcode secrets — use environment variables
3. Run `npm audit` / `pip audit` before committing
4. Review `git diff` before every push
5. Treat Grok `permission_mode` and sandbox settings as a safety layer, not a substitute for review
