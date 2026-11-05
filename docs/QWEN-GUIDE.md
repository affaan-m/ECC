# Qwen CLI Adapter Guide

ECC can install its managed command, agent, skill, rule, and MCP surfaces into the Qwen CLI home directory.

## Native extension installation and common rules

Qwen Code also supports installing the Claude marketplace package through its
own extension manager:

```bash
qwen extensions install https://github.com/affaan-m/ECC:ecc
```

This is a different installation path from the managed adapter below. On Qwen
Code 0.26.1 with the ECC v2.2.3 release, the extension loads skills and commands,
but reports eleven rule warnings: ten files in `rules/common/` and
`rules/README.md` have no `paths:` frontmatter.

This is intentional Qwen behavior: **extension rules must be conditional**.
User rules under `~/.qwen/rules/` (or `$QWEN_HOME/rules/` when set) may instead
be baseline instructions, loaded from the first request. See the [Qwen rules documentation](https://qwenlm.github.io/qwen-code-docs/en/users/features/rules/).
Do not add artificial `paths: ["**/*"]` to shared ECC rules just to silence the
warnings; that changes when they apply and does not preserve baseline semantics.
`rules/README.md` is installation documentation and should not become a rule.

If you explicitly want ECC's common policies in every normal Qwen session
(outside safe mode), you can
supplement the extension with a user-owned copy of **only** its common rules:

```bash
# If QWEN_HOME is set, export it as an absolute path (not a quoted ~/ path).
# Inspect these policies first: they include TDD, coverage and delegation rules.
# Stop if the destination exists; review/merge existing files instead of overwriting.
test -d "${QWEN_HOME:-$HOME/.qwen}/extensions/ecc/rules/common" && \
  test ! -e "${QWEN_HOME:-$HOME/.qwen}/rules/ecc/common" && \
  test ! -L "${QWEN_HOME:-$HOME/.qwen}/rules/ecc/common" && \
  mkdir -p "${QWEN_HOME:-$HOME/.qwen}/rules/ecc" && \
  cp -R "${QWEN_HOME:-$HOME/.qwen}/extensions/ecc/rules/common" "${QWEN_HOME:-$HOME/.qwen}/rules/ecc/"
```

For project-only scope, use `<project>/.qwen/rules/ecc/` as the destination;
project rules load only in trusted workspaces. Choose one scope to avoid
duplicating the same baseline policies. Keep the `common/` subdirectory.

These copies are not owned or updated by the extension manager. After
`qwen extensions update ecc`, compare them with the extension's common rules
and refresh deliberately, preserving any local edits. To undo this supplement,
remove only the copied `common/` directory after checking for local changes.
The original extension warnings remain: verify that the user/project copies
load, rather than treating warning disappearance as proof of success.

Do not run `--modules rules-core` over an active extension as a minimal repair:
it installs the entire rules tree, including language rules already supplied by
the extension and the README. Likewise, do not layer a full managed install
over the extension unintentionally. Successful skill loading does not establish
hook-runtime compatibility.

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
