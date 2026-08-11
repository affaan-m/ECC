# .pi — Pi Coding Agent Integration

This directory contains the **Pi adapter** for ECC — a thin extension that connects the
[@earendil-works/pi-coding-agent](https://github.com/earendil-works/pi-coding-agent)
terminal coding agent to ECC's canonical skills, prompts, and lifecycle hooks.

## Design Principle

ECC's canonical assets—skills, agents, commands, and hooks—**remain the single source of truth**.
This adapter contains **only the integration logic**. No copies, no duplication.

## What This Provides

- **ECC's skills** from `./skills/` — available in Pi as `/skill:<name>`
- **ECC's commands** from `./commands/` — available in Pi as `/<name>`
- **Session lifecycle hooks** — ECC's SessionStart and SessionEnd hooks, run through ECC's own
  `run-with-flags.js`, so `ECC_HOOK_PROFILE` and `ECC_DISABLED_HOOKS` keep working under Pi
- **Session context injection** — whatever ECC's SessionStart hook returns as
  `additionalContext` is folded into Pi's system prompt for the next turn
- **`/ecc-doctor`** — diagnostic command to verify the integration

Verified against Pi 0.84.1: a global install exposes 285 skills and 94 commands, resolved
directly from `skills/` and `commands/`, with no generated copies.

## Installation

### Option 1: Global Installation (Recommended)

```bash
# Install ECC as a Pi package
pi install git:github.com/affaan-m/ECC

# Or from a local checkout
pi install /path/to/ECC

# Or project-local only
pi install -l /path/to/ECC

# Verify
pi list
```

Then inside Pi, run `/ecc-doctor` to confirm skills, commands, and hooks are available.

To uninstall:

```bash
pi remove git:github.com/affaan-m/ECC
```

### Option 2: Zero-Install (Existing Claude Code Users)

If you already have ECC installed for Claude Code, point Pi at the same canonical directories
from `~/.pi/agent/settings.json`:

```json
{
  "skills": ["~/.claude/skills"],
  "prompts": ["~/.claude/commands"]
}
```

This gives you skills and commands directly. It does **not** include the lifecycle hook adapter
or `/ecc-doctor` — use Option 1 for the full integration.

## How It Works

The `extensions/index.ts` file handles:

1. **Skill and command mounting** — Pi reads `./skills` and `./commands` directly via the
   `pi` key in `package.json`. No transformation is needed: ECC's `SKILL.md` files already
   follow the Agent Skills standard Pi implements, and ECC's command frontmatter
   (`description`, `argument-hint`) is already Pi's prompt-template format
2. **Lifecycle hooks** — Maps Pi's `session_start` to ECC's `session:start` hook
   (`scripts/hooks/session-start.js`) and Pi's `session_shutdown` to ECC's `session:end:marker`
   hook (`scripts/hooks/session-end-marker.js`), both invoked through
   `scripts/hooks/run-with-flags.js` so ECC's profile and disable flags are honored
3. **Context injection** — Parses `hookSpecificOutput.additionalContext` from the SessionStart
   hook and appends it to the system prompt on the next `before_agent_start`, wrapped in an
   `<ecc-session-context>` block. Non-JSON hook output is tolerated, not treated as an error
4. **Hook isolation** — Failing, missing, or slow hooks degrade to a warning and never
   terminate the Pi session. Hook execution is bounded by a timeout and an output limit
5. **Package resolution** — Resolves hook scripts from the installed package via `__dirname`,
   never from `process.cwd()`, so a global install works from any project directory. Hooks
   still *run* in the user's project directory, so project detection stays correct

All hook execution is non-shell (`execFile` without shell interpretation), so paths containing
spaces, tabs, or shell metacharacters are safe.

## Scope

Intentionally **out of scope** for this first adapter (to be added independently):

- Subagent conversion and chains (need the `pi-subagents` companion package)
- Structured approval gates (need `@juicesharp/rpiv-ask-user-question`)
- Persistent todos (need `@juicesharp/rpiv-todo`)
- Profile-based resource filtering
- MCP translation — see below; no translation turned out to be necessary

ECC works in Pi without any of these. Skills and commands are fully available today.

These capabilities are provided by existing community Pi packages rather than by
anything ECC would need to write. This adapter deliberately does not bundle or
auto-install them: bundling would ship third-party code that executes with full
user permissions in every ECC install, and would make optional capabilities
mandatory. Install whichever you want yourself — `/ecc-doctor` reports which are
present and prints the exact `pi install` command for the ones that are not.

### MCP

Pi core has no MCP surface by design. The community `pi-mcp-adapter` package
adds one, and it reads the standard `mcpServers` format from `.mcp.json` and
`~/.config/mcp/mcp.json` — which is exactly the format ECC already uses in
`.mcp.json` and `mcp-configs/mcp-servers.json`.

Verified against `pi-mcp-adapter` 2.21.2: copying ECC's `mcp-configs/mcp-servers.json`
to a project's `.mcp.json` registers Pi's `mcp` tool and `/mcp` command with all
35 ECC servers discovered, alongside this adapter's own `/ecc-doctor`. No
translation layer is needed and no ECC change is required.

```bash
pi install npm:pi-mcp-adapter
cp mcp-configs/mcp-servers.json /path/to/project/.mcp.json
```

ECC neither installs nor depends on that package. Two caveats: the adapter's
first run against a new config performs initialization that blocks in
non-interactive (`-p`) mode, so run it once interactively before using it
headless; and only server discovery was verified, not live tool invocation,
which needs real credentials for each server.

## Security

- Pi extensions run with the same OS permissions as the Pi process
- This adapter does **not** auto-commit, push, merge, or deploy
- Hooks are executed without a shell, preventing command injection
- Hook failures are isolated and cannot silently authorize blocked operations

## Troubleshooting

### Skills or commands not showing up

**Cause:** the package's resources are disabled, or a project-local install has not been
trusted. Pi asks before trusting a project folder that carries its own `.pi/` resources.

**Fix:** run `pi config` and confirm the ECC package's skills and prompts are enabled
(<kbd>Tab</kbd> switches between user and project scope). Then confirm the package itself is
registered with `pi list`.

### `/ecc-doctor` not found or reports missing package root

**Cause:** Extension not loaded or package installed incorrectly.

**Fix:**
1. Run `pi list` to confirm ECC is registered
2. Restart Pi: exit and reopen the session
3. Run `/ecc-doctor` again

`/ecc-doctor` prints the resolved package root, the skill and command counts it found, the
hook runner path, the active hook profile, and which optional companion packages are present.
A `NOT FOUND` line points at the specific path that failed to resolve.

### Hooks not firing

**Cause:** the extension is not loaded, or the hooks are gated off by an ECC hook profile.

**Fix:**
1. Confirm `pi list` shows ECC and that `/ecc-doctor` reports the hook runner as found
2. Check `ECC_HOOK_PROFILE` and `ECC_DISABLED_HOOKS` — `/ecc-doctor` prints both. A hook
   listed in `ECC_DISABLED_HOOKS` is skipped by design
3. Restart Pi so the extension reloads

## Notes

- The `.pi/extensions/` directory is the only place for adapter code
- Skills and commands are defined in the repo root (`skills/`, `commands/`) and referenced by Pi
- MCP servers are intentionally out of scope; use ECC's MCP configs with other harnesses
- This adapter was tested against Pi v0.84.1
