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

## Agent adaptation

Managed Qwen installs adapt canonical agent tools and colors before recording ownership.
Claude model tiers become `model: inherit`, so the configured Qwen session selects its provider.
Canonical agent files stay unchanged. The standalone `scripts/qwen-adapt-agents.js` utility
can adapt an explicitly selected, user-owned copy; use the managed installer for ECC-owned files
to keep repair and uninstall receipts consistent. Native subagent dispatch still requires
verification in the user's configured Qwen runtime.

Qwen Code 0.25.0 treats omitted, null, and empty `tools` fields in named-agent
files as inheriting the parent tool registry. An empty definition list differs
from the internal runtime `ToolConfig` and `fork_tools` deny-all contracts.
See the [official named-agent conversion](https://github.com/QwenLM/qwen-code/blob/v0.25.0/packages/core/src/subagents/subagent-manager.ts#L1661-L1685)
and [empty-list validation](https://github.com/QwenLM/qwen-code/blob/v0.25.0/packages/core/src/subagents/validation.ts#L216-L226).
ECC rejects an explicitly empty or null source tools field before managed
installation writes or standalone batch rewrites, because this adapter cannot
represent a deny-all agent through that native field. Use a nonempty explicit
allowlist, or omit the field only when parent-tool inheritance is intended.
These checks verify adaptation and write prevention; they do not certify native
provider execution or sandbox containment.
