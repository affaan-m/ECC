# .grok-plugin — Grok Build Native Plugin for ECC

This directory is the **Grok Build plugin and marketplace manifest** for ECC.
Component files stay at the repository root (`skills/`, `commands/`, `agents/`,
`hooks/hooks.json`, `.mcp.json`). `.grok-plugin/` only holds Grok's index.

Grok also reads `.claude-plugin/plugin.json`, but Claude's marketplace
`"source": "./"` is rejected by Grok as an empty path. Keep a Grok-specific
catalog here. Do not point Grok at `plugins/ecc/`: Codex already showed that a
thin subdirectory copy drops parent-relative runtime files.

## Install

ECC installs through the canonical installer and receipt lifecycle:

```bash
node scripts/grok-install.js --dry-run --trust --consent-hooks --consent-mcp chrome-devtools
node scripts/grok-install.js --trust --consent-hooks --consent-mcp chrome-devtools
node scripts/repair.js --target grok
node scripts/uninstall.js --target grok
```

`scripts/grok-install.js` is a thin alias for `install-apply.js --target grok
--profile full`; state stays at `~/.grok/ecc/install-state.json`. Upgrade and
rollback use the same canonical apply path; pass `--source-sha <40-hex>` to
reapply a previous pinned commit.

Fetching a pinned snapshot accepts HTTPS URLs or absolute local repository
paths (including local `file://` URLs). SSH, relative remote names, and custom
Git remote-helper transports are rejected before fetching.

The marketplace pin advances with releases, not every source commit. Ordinary
CI validates the SHA and its ancestry. `scripts/release.sh` commits the release
metadata, pins that source commit in a separate catalog commit, and validates
the result before tagging. Release workflows also run
`node scripts/ci/validate-grok-pin.js --release` to reject unpublished source
changes after the pinned snapshot.

Grok CLI marketplace add / install / enable is **discovery only**.
`grok plugin install --trust` skips Grok's confirmation prompt; it is **not
ECC capability consent** and does not write an ECC receipt. `plugin.json`
sets `mcpServers` and `hooks` to empty strings so that native CLI path does
not attach root `.mcp.json` or `hooks/hooks.json`.

```bash
grok plugin marketplace add affaan-m/ECC
grok plugin install ecc
grok plugin enable ecc
grok plugin validate .
```

Local checkout, including unpublished changes:

```bash
grok plugin install /absolute/path/to/ECC
grok plugin enable ecc
grok plugin validate /absolute/path/to/ECC
```

Do not also run `./install.sh --target claude` (or a full manual Claude copy)
into the same Grok session. Pick one install path per harness.
`./install.sh --target grok --profile full` does not copy hooks or root MCP
without `--trust` and the matching consent flags.

## Hooks

Grok sets `GROK_PLUGIN_ROOT`. Shared hook code does not read that alias.
The Grok target adapter maps it onto the shared root contract in the installed
hook configuration when hooks are consented. Without hook consent, the installed copy has no
`hooks/hooks.json`.

The Grok-only hook projection maps shared `Bash` and `PowerShell` matchers to
Grok's `run_terminal_command` tool. On Windows it starts hook commands with the
Node executable used by the canonical installer, so hook startup does not rely
on Grok's inherited `PATH`. Other harnesses continue to use the shared hook
configuration unchanged.

Grok does not honor Claude `userConfig`. Hook enablement and profile stay on
environment variables after explicit hook consent:

```bash
export ECC_HOOKS_ENABLED=true
export ECC_HOOK_PROFILE=standard   # minimal | standard | strict
```

## MCP

`.grok-plugin/plugin.json` sets `"mcpServers": ""` so a trusted Grok plugin
install does not attach repo-root `.mcp.json` or `chrome-devtools`. That root
file remains for Claude/Codex. Additional connectors stay opt-in via
`mcp-configs/mcp-servers.json`. Canonical receipts record explicit per-server
consent before any MCP name is copied into an install plan.

## Native lifecycle verification

With a real `grok` executable on `PATH`, run the opt-in acceptance driver:

```bash
node tests/ci/grok-native-lifecycle.js --report /tmp/grok-native-lifecycle.json
```

It uses fresh temporary homes without inherited credentials and fails if Grok is
missing. It verifies ECC discovery, trust refusal, independent hook/MCP consent,
disabled and missing roots, Git update, rollback, immutable pins, and uninstall.
Native Git transitions use a disposable full ECC archive with synthetic versions;
canonical lifecycle tests also require real `grok inspect` readbacks. Temporary
installations are removed on exit. See the
[recorded run and evidence boundaries](../docs/releases/2.2.3/grok-native-lifecycle.md).

## Known limits

- 311 skills are advertised into Grok's skill catalog. Use a smaller working
  set when context footprint matters.
- Agent files load, but ECC agent `tools:` lists use Claude names (`Read`,
  `Bash`). Grok hook matchers map those names; agent frontmatter does not.
- Grok has no plugin `rules/` component. Put always-on constraints in
  `AGENTS.md` or Grok project rules.
