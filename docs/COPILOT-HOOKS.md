# Copilot CLI hook adapter

The managed `copilot` target provides an audited subset of ECC's canonical
hook policies. This is partial functional compatibility, not full parity with
Claude Code and not a native Copilot plugin package.

## Install

Use Node.js 18 or newer and a Copilot CLI release supporting command hooks
with `exec` and `args`, as described in the
[GitHub hook reference](https://docs.github.com/en/copilot/reference/hooks-reference).
The CLI must find `node` on `PATH`. This adapter has automated subprocess and
installer tests; native CLI certification and Windows/macOS execution remain
unobserved until tested on those hosts. No minimum CLI version is inferred
from the documentation.

Run the installer from the destination project, using your ECC checkout:

```bash
node /path/to/ECC/scripts/install-apply.js --target copilot --modules hooks-runtime --enable-hooks
```

For the complete supported catalog, use `--profile full --enable-hooks` in
place of `--modules hooks-runtime --enable-hooks`. Use `--profile full
--no-hooks` to install the catalog without automatic hooks. The existing
installer consent gate applies to Copilot as it does to other hook targets.

To disable previously installed ECC hooks, preview your intended catalog
selection with `--no-hooks --dry-run`, then apply it with `--no-hooks`.
The installer removes `.github/hooks/ecc.json` only when it is a verified,
unchanged ECC-managed file. Modified, linked, unowned or unverifiable manifests
block the transition and require review. The installer retains other manifests,
runtime helpers and private data. Start a new Copilot session to verify host
behavior after changing the manifest.

On Windows, invoke `node` with the path to the same script. Hook entries use
direct executable arguments rather than platform-specific shell quoting.

Managed files are `.github/hooks/ecc.json`, the explicit script dependency
closure in `.github/ecc/scripts/`, and `.github/ecc-install-state.json`.
For ESM projects, the managed scripts directory gets a CommonJS package
boundary so hooks can start without editing the project's `package.json`.
No runtime npm install, Claude installation, credential transfer, MCP server,
is needed. Optional lifecycle checkpoints use a separate private Copilot cache;
see [memory and lifecycle](COPILOT-LIFECYCLE.md). Other hook JSON files remain independent.
An existing unowned `ecc.json` is preserved and not claimed by ECC; inspect
the install result for skipped files before expecting the adapter to activate.
Repair restores missing managed files for enabled installs. If a legacy record
declines hooks but still owns the activation manifest, rerun the intended
selection with `--no-hooks` before repairing. Uninstall preserves unowned files.

## Policy coverage

| Policy ID | Copilot event | Native tools | Behavior |
| --- | --- | --- | --- |
| `pre:bash:block-no-verify` | `preToolUse` | `bash` | Legacy callable policy; generated manifest runs its scanner through the combined guard |
| `pre:config-protection` | `preToolUse` | `create`, `edit`, `str_replace_editor`, `apply_patch` | Checks existing linter/formatter config targets, including patch move destinations |
| `pre:write:doc-file-warning` | `preToolUse` | `create` | Returns canonical advice for ad-hoc documentation filenames |
| `pre:copilot:guard` | `preToolUse` | Bash, PowerShell, edits and writes | Canonical destructive-operation and sensitive-target checks; see [guard limits](COPILOT-GUARD.md) |
| `post:edit:copilot-quality` / `stop:copilot-quality` | `postToolUse` / `agentStop` | Successful observed edits | Accumulation, local formatter/typecheck, design and console feedback; [check/fix modes](COPILOT-QUALITY.md) |
| `copilot:observe` | `preToolUse` / `postToolUse` | Observed tool events | Opt-in metadata-only records; no worker or automatic instinct activation |

The legacy `post:edit:console-warn` and `pre:bash:block-no-verify` adapters remain
callable for compatibility. The generated manifest uses the stop quality check
and combined guard so each policy runs once per delivery.

`create_file` and canonical `Write`/`Edit` names are also accepted. Structured
arguments can be objects or JSON strings. Native `path` and canonical
`file_path`/`file` aliases must agree. Paths resolve against the event's `cwd`.
Only the documented `*** Begin Patch` format with Add/Update/Delete File or
Move to headers is recognized; an unsupported patch payload is denied by
pre-tool hooks rather than silently bypassing target inspection. Multi-edit
entries must provide a path or inherit the top-level path.

The Bash scanner is not advertised as a PowerShell policy. Unknown tools
retain their names and do not activate these policies. Config protection
does not inspect arbitrary shell writes, external programs or unknown tool
schemas. These hooks are workflow controls, not a filesystem sandbox.

## Execution and controls

Policy entries invoke the Copilot adapter with a fixed event and
policy ID. Quality, observations, lifecycle and Hookify have fixed dedicated entrypoints.
The adapter starts only its allowlisted canonical Node.js script,
with no shell interpolation. Tool commands are inspected as data and never
executed by the adapter. It emits one JSON result, never the incoming event.
A successful policy leaves normal Copilot permission handling in place; it
does not manufacture `permissionDecision: "allow"`.

Pre-tool parsing errors, child failures and internal timeouts produce a deny.
Input is limited to 1 MiB of UTF-8, child output to 1 MiB, batch edits to 64
targets, and each child to five seconds. Batched diagnostics share an eight
second budget, below the generated 15 second outer timeout. Copilot's own
outer timeout behavior remains controlled by Copilot; the adapter cannot
guarantee a denial if the host kills it first.

Canonical nested permission/context fields are projected into Copilot output.
Post-tool stderr warnings become bounded `additionalContext`. Pre-tool advice
is returned as `additionalContext`; visibility of that field depends on the
installed CLI's pre-tool output handling and must be checked during native
validation. Blocking decisions do not depend on advice visibility.

The policies run in `standard` and `strict` hook profiles. Existing
`ECC_HOOKS_ENABLED`, `ECC_HOOK_PROFILE`, `ECC_DISABLED_HOOKS` and explicitly
selected `ECC_HOOK_CONFIG` controls apply. For example:

```bash
ECC_DISABLED_HOOKS=pre:config-protection copilot
ECC_HOOKS_ENABLED=false copilot
```

PowerShell equivalents are `$env:ECC_DISABLED_HOOKS = 'pre:config-protection'`
and `$env:ECC_HOOKS_ENABLED = 'false'` before starting Copilot. Claude plugin
root/option fallbacks are omitted from the child environment so they cannot
override this independent installation's managed hook configuration.

## Validation and remaining porting work

```bash
node tests/hooks/copilot-hook-adapter.test.js
node tests/lib/copilot-hooks-install.test.js
node tests/lib/copilot-install-target.test.js
node tests/docs/copilot-support.test.js
```

Tests exercise canonical policies, payload conversion, malformed and oversized
input, UTF-8 limits, conflicting path aliases, flags, installation consent,
ownership collisions, reinstall, repair and uninstall. Run the generated
commands in a real Copilot session on Windows, macOS and Linux before claiming
native lifecycle parity. Confirm both the denial and the agent-visible reason,
and verify normal Copilot permissions still apply to successful calls.

Four additional native events now use a dedicated Copilot session runtime:
`sessionStart`, `agentStop`, `preCompact`, and `sessionEnd`. See
[memory and lifecycle](COPILOT-LIFECYCLE.md) for storage, opt-in transcript
observations, limits and validation. [Command compatibility](COPILOT-COMMANDS.md)
documents projected workflows and explicitly unavailable commands.

Formatter/typecheck automation is fixture-tested; native host delivery remains unverified.
[Selective MCP configuration](COPILOT-MCP.md), [Memory Vault handoff](COPILOT-MEMORY.md),
[telemetry](COPILOT-TELEMETRY.md) and [agent restrictions](COPILOT-AGENT-TOOLS.md)
have explicit entrypoints and separate acceptance limits. Automatic background learning,
native plugin packaging and behavioral parity evaluations remain open.
See [implementation status](COPILOT-IMPLEMENTATION-STATUS.md) for phase gates.
Claude transcript consumers are not activated by this adapter.
