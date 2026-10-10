# DeepSeek Harness Guide

ECC runs on the [DeepSeek Harness](https://github.com/deepseek-ai/dsh) (DSH) via its
native skill roots and the first-party Claude Code hooks bridge. This guide covers
what works out of the box, how to mount the ECC hooks, and the current limits.

Unlike the Qwen or Codex adapters, there is no dedicated installer target yet; the
setup is a small amount of manual configuration described below.

## Prerequisites

- DeepSeek Harness 0.2.0-rc.1 or newer (`dsh --version`).
- ECC repository cloned locally, for example `~/ECC` (the hooks bridge commands
  reference this path, so keep the checkout in place).
- Skills need no extra tooling; hooks use the `@deepseek-ai/dsh-hooks-claude-code`
  plugin that ships inside the DSH runtime itself.

## Skills (automatic)

DSH loads skills from these roots (earlier roots win on name conflicts):

```text
<project>/.dsh/skills
<project>/.agents/skills
custom dirs (~/.dsh/profiles/<profile>/cordis.patch.yml -> skill-filesystem)
~/.dsh/skills
~/.agents/skills
```

Because ECC already ships `.agents/skills/` for Codex, opening a session with the
ECC checkout as the working directory exposes a subset of ECC skills immediately.
To expose the full curated set in every project, link the catalog once:

```bash
ln -s /path/to/ECC/skills/<skill-name> ~/.dsh/skills/<skill-name>
```

Run this per skill with real names substituted for both placeholders (for
example `ln -s ~/ECC/skills/tdd-workflow ~/.dsh/skills/tdd-workflow`); the
angle brackets are placeholders, not shell syntax.

DSH reads `SKILL.md` frontmatter (name/description), which matches the ECC skill
format, so no conversion is needed. Name conflicts with pre-existing user skills
are resolved by root priority; skip those skills when linking.

## Hooks

### How the bridge works

DSH bridges ECC command hooks through `@deepseek-ai/dsh-hooks-claude-code`
(first-party, bundled with the runtime). Constraints that shape the conversion:

- Supported events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
  `PostToolUse`, `Stop`, `SubagentStart`, `SubagentStop`. ECC events without a
  bridge counterpart (`PreCompact`, `PostToolUseFailure`, `SessionEnd`) are
  skipped by the generator.
- DSH tool names are lower-case (`bash`, `edit`, `write`, `skill`, `task`),
  while ECC matchers use Claude Code names (`Bash`, `Edit|MultiEdit`, ...). The
  generator maps known tool names and keeps regex passthrough tokens.
- The bridge runs commands with `bash -c` and does not export the plugin root as
  an environment variable for hook processes. The generator prefixes each command
  with `CLAUDE_PLUGIN_ROOT=<ecc-root> ECC_PLUGIN_ROOT=<ecc-root>` (env-prefix
  form), which the ECC hook bootstrap reads at startup.
- `timeout` values are seconds in both formats and are preserved.

### Generate the config

```bash
node scripts/dsh/generate-hooks-config.js --ecc-root /path/to/ECC --out ~/.dsh/ecc/hooks-dsh.json
```

The script validates nothing about your DSH install; it only converts
`hooks/hooks.json` into the bridge format and prints what it skipped.

### Mount into a profile

Add a bare insert entry to the profile patch layer
(`~/.dsh/profiles/<profile>/cordis.patch.yml`). This mirrors how the bundled web
app preset mounts its plugins:

```yaml
- insert:
    - id: ecc-hooks-claude-code
      name: "@deepseek-ai/dsh-hooks-claude-code"
      config:
        configPath: /absolute/path/to/hooks-dsh.json
```

Configuration notes from practice:

- A plain top-level entry (`- id: ...`) is silently dropped; the loader only
  treats `insert` entries as additions.
- `insert` under an existing non-group id is rejected ("not a group"); use a bare
  insert without a target id.
- The plugin package does not need to be added to the profile `package.json`;
  first-party plugins resolve from the DSH runtime install.
- Validate without booting: `cd ~/.dsh && dsh --profile <profile> --dump-config`
  (compose errors and dropped entries are reported on stderr).

### Verify

```bash
# Compose check (no session boot). Keep stderr visible: silently dropped or
# rejected patch entries are reported there while the exit status stays 0.
cd ~/.dsh && dsh --profile web --dump-config > /tmp/dump.yml

grep ecc-hooks /tmp/dump.yml

# End-to-end: fire a SessionStart hook in a one-shot headless session
# (uses a test config with a single marker-writing hook)
dsh --profile headless --patch /tmp/ecc-patch-test.yml 'Reply with exactly: BOOT-OK'
```

A successful compose does not prove the entry mounted: dropped entries and
"is not a group" rejections only appear on stderr, never in the exit status.
Confirm the entry id exists in the dump and that stderr was empty.

In a live web session, the GateGuard fact-forcing hook denies the first
edit/write/bash attempt until facts are presented — a visible signal that the
bridge is active.

## Updating

```bash
cd /path/to/ECC && git pull
node scripts/dsh/generate-hooks-config.js --ecc-root /path/to/ECC --out ~/.dsh/ecc/hooks-dsh.json
```

Linked skills reflect the pull immediately (symlinks), only the hooks config
needs regeneration.

## Scope

| Surface | Status on DSH |
|---------|---------------|
| Skills (293) | Works; link or rely on `.agents/skills` |
| Hooks (20 command hooks, 4 of 7 events) | Works via the bridge; 3 events unsupported |
| Commands (94 slash commands) | Not available (Claude Code mechanism); workflows are covered by skills |
| Agents (68) | Not available as subagents; equivalent personas exist as skills |
