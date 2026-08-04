# Qwen CLI Adapter Guide

ECC can install its managed command, agent, skill, rule, and MCP surfaces into the Qwen CLI home directory.

## Install

From the ECC repository root:

```bash
./install.sh --target qwen --profile minimal
```

Preview a larger install before copying files:

```bash
./install.sh --target qwen --profile full --dry-run
```

The Qwen adapter writes into `~/.qwen/` and records managed file ownership in `~/.qwen/ecc-install-state.json`.

## Installed Layout

The managed install can populate:

```text
~/.qwen/
  QWEN.md
  agents/
  commands/
  mcp-configs/
  rules/
  skills/
  ecc-install-state.json
```

The installer preserves the source layout for rules, so language rule sets stay under paths such as `~/.qwen/rules/common/` and `~/.qwen/rules/typescript/`.

## Updating

Rerun the same install command after pulling ECC updates. The installer uses the install-state file to update ECC-managed files without claiming unrelated user files in `~/.qwen/`.

## Uninstalling

Use the managed uninstall path rather than deleting the whole Qwen directory:

```bash
node scripts/uninstall.js --target qwen
```

That removes files recorded in `~/.qwen/ecc-install-state.json` and leaves unrelated Qwen configuration alone.

## Scope

This target is intentionally narrower than stale PR #1352. It ports the maintainable Qwen install-target intent onto the current selective installer and avoids unverified hook-runtime claims until Qwen's hook/event contract is confirmed.
