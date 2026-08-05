# Plugin Profiles

Generate slim, per-project ECC plugins for Claude Code from the
selective-install manifests.

## The Problem

Installing ECC as a Claude Code plugin loads the frontmatter of every skill,
agent, and command into session context — roughly 30k tokens for the full
catalog — in every session, in every project. The selective-install system
(`manifests/install-profiles.json`, `install-modules.json`,
`install-components.json`) already describes smaller surfaces, but it only
serves installer targets (`./install.sh`, `ecc install`). The marketplace
plugin path ignores it entirely, and Claude Code has no native way to enable a
subset of one plugin.

Plugin profiles close that gap: any install plan can be materialized as a
standalone slim plugin, published through a local marketplace, and chosen per
project via `enabledPlugins`.

## Quick Start

```bash
# See available profiles
node scripts/plugin-profiles.js list

# Preview a profile's plugin surface and per-session context cost
node scripts/plugin-profiles.js plan --profile developer

# Generate the plugin + local marketplace (default: ~/.claude/ecc-profiles)
node scripts/plugin-profiles.js generate --profile developer

# Register and install it
claude plugin marketplace add ~/.claude/ecc-profiles
claude plugin install ecc-developer@ecc-profiles
```

Then choose the profile per project. In a project's `.claude/settings.json`
(or `settings.local.json`):

```json
{
  "enabledPlugins": {
    "ecc@ecc": false,
    "ecc-developer@ecc-profiles": true
  }
}
```

Settings resolution happens before session context assembly, so this is the
one lever that actually shrinks the injected catalog — a `SessionStart` hook
cannot remove catalog text that is already loaded. Subagents inherit the
session's plugin surface, so the slim profile applies to every spawned agent
automatically.

Note: `claude plugin install` enables the new plugin at user scope. If you
only want per-project use, set it back to `false` in `~/.claude/settings.json`
after installing, and enable it only inside the projects that want it.

## What Gets Generated

For each selected module, paths are classified into the plugin surface:

| Module path | Plugin surface | Context cost |
|---|---|---|
| `skills/<id>` / `skills` | `skills/` (copied) | frontmatter per skill |
| `agents` / `agents/<f>.md` | `agents/` (copied) | frontmatter per agent |
| `commands` / `commands/<f>.md` | `commands/` (copied) | frontmatter per command |
| `hooks`, `scripts/**` | copied verbatim | zero (runtime only) |
| `rules`, `.agents`, platform configs | skipped | installer-only surfaces |

Hook runtime is included by default (`--no-hooks` to opt out): hooks cost no
session context, so a slim profile keeps full GateGuard/session-hook parity
with the monolith. The generated `.claude-plugin/plugin.json` follows the
Claude validator rules pinned in `tests/plugin-manifest.test.js` (no `agents`
or `hooks` keys, explicit empty `mcpServers`).

Approximate per-session catalog cost by profile (ecc@2.1.0):

| Profile | Skills | Catalog tokens | vs full |
|---|---|---|---|
| full | 280 | ~30k | — |
| developer | 121 | ~17k | −44% |
| minimal | 44 | ~12k | −60% |
| custom component selections | any | often 2–5k | −80% or more |

## The ecc-catalog Escape Hatch

Every generated profile includes a synthesized `ecc-catalog` skill (disable
with `--no-catalog`): one cheap frontmatter entry whose body indexes the full
upstream skill catalog with descriptions, install status, and the source root
path. When a task needs a skill outside the profile, the agent reads that
skill's `SKILL.md` from the source tree on demand — a slim profile narrows the
default surface without ever losing capability.

## Custom Selections

`plan` and `generate` accept the same selection vocabulary as the installer:

```bash
# Profile plus extra components
node scripts/plugin-profiles.js generate --profile minimal \
  --with skill:react-patterns,agent:python-reviewer --name ecc-frontend

# Module-level, no profile
node scripts/plugin-profiles.js generate \
  --modules commands-core,workflow-quality --name ecc-lite

# Exclude components from a profile
node scripts/plugin-profiles.js generate --profile developer \
  --without capability:orchestration
```

Component IDs come from `manifests/install-components.json` plus synthetic
per-skill components (`skill:<dir>`), exactly as in `install-plan.js`.

## In-Session Tooling

Two companions make profiles usable without leaving Claude Code:

- **`/plugin-profiles` command** (`commands/plugin-profiles.md`) wraps this
  CLI: `list`, `plan <profile>`, `generate <profile>`, and `activate
  <plugin-name>` (offers the per-project `enabledPlugins` edit with explicit
  confirmation).
- **Skill-router hook** (`scripts/hooks/skill-router.js`, UserPromptSubmit,
  id `user-prompt:skill-router`) scores each prompt against the skill catalog
  with offline token matching and injects up to three matches as context —
  installed skills directly, uninstalled ones with their on-demand SKILL.md
  path. Generated profiles carry an `ecc-profile.json` pointing at the source
  repository, so routing always covers the full catalog even under a minimal
  profile. It emits nothing when no skill clearly matches, and is disabled
  like any hook via `ECC_DISABLED_HOOKS=user-prompt:skill-router`.

## Refreshing After Updates

Generated plugins snapshot the repo at generation time. After updating ECC,
re-run the same `generate` command, then reinstall the plugin
(`claude plugin uninstall` + `install`) so the plugin cache picks up the new
content. The generated plugin version always tracks the source `package.json`
version.

## Limitations

- Claude Code cannot partially enable a plugin, so a project uses either the
  full `ecc` plugin or a generated profile — the profile replaces the
  monolith in that project's `enabledPlugins`.
- Rules and platform configs are installer surfaces; Claude plugins do not
  load them, so they are skipped (use `./install.sh` for those).
- The generated marketplace is local to the machine. Committing generated
  profile plugins to a shared repo works, but treat them as build artifacts.
- `ecc-profile.json` embeds the machine-local absolute path of the source
  checkout (and a catalog snapshot). Do not copy a generated plugin to
  another machine — regenerate it there instead. On a machine where the
  recorded path does not exist (or fails the ECC-checkout check), the
  skill-router hook silently falls back to routing installed skills only.
