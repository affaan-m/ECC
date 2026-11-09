# ADR: Experimental Copilot plugin artifact format

Date: 2026-11-03. Status: accepted for source preparation; native activation and
M1/M2 certification remain open. CLI examined: GitHub Copilot CLI **1.0.105** on
Linux x64. This ADR does not set a supported minimum CLI version.

## Context

The project target already owns transforms, selected runtime dependencies and
managed file generation. A plugin has a different root and cannot execute
project-relative `.github/ecc` paths from arbitrary working directories.
Copying a Claude manifest or an entire developer checkout would neither preserve
that contract nor exclude private state. P13 follows M1 for certification; this
experimental artifact work does not bypass that gate.

## Decision

Generate an Agent Plugins 1.0 artifact with the exact root schema URL
`https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`. Keep portable skills
under `skills/`, and Copilot components under `com.github.copilot/agents`, `rules`
and `hooks`. Agent Markdown is emitted with `.agent.md` filenames.

Use the existing project installer plan and transformations in an empty staging
project. Copy only the plan's declared output operations, the two explicit
plugin launcher modules and the canonical CommonJS scope marker. Read each
addition from the selected source checkout. Package no install receipt, private state, credentials,
Git metadata, dependency cache or developer home. Record each output's digest.

Bundled helper references in projected skills use an explicit
`<ECC_PLUGIN_ROOT>` placeholder. Instructions require resolving it from the
actual discovered skill source, preserving quoted paths and the project working
directory. The placeholder is not a shell environment variable. This avoids
baking a build location that would break after CLI cache relocation. Its model
following behavior still needs authenticated acceptance.

Prepare hook entries through a fixed bundled launcher, with plugin root derived
from the launcher's own file. Keep `disableAllHooks: true` in generated artifacts
until native plugin-root expansion and session delivery have been demonstrated.
The CLI accepted local artifacts offline, but refused a prompt before session
hooks because no authentication was configured. No root-expansion proof can be
inferred from that refusal.

Reject plugin hook execution when the project already has an ECC installer
receipt or `ecc.json`. Expose a read-only artifact and project collision preview
and use the existing ownership-aware project uninstaller for reviewed migration.
The preview does not grant permission to remove user-owned files.

## Alternatives

The legacy Copilot format was also accepted by CLI 1.0.105 in a local fixture.
Its configurable locations offer no benefit for this generated layout. The
Agent Plugins schema makes the portable and Copilot-specific component boundary
explicit. Copying `.claude-plugin/plugin.json` was rejected because its component
paths and runtime assumptions do not constitute a verified Copilot artifact.

## Evidence and consequences

CLI 1.0.105 installed the generated artifact with **389 skills** discovered in
an empty fixture project. `plugin list --json` showed it enabled; disabling it
removed those skills from native discovery; enable and uninstall completed, and
the final plugin list no longer contained it. Direct local installs also emitted
a deprecation warning: future CLI versions may require marketplace installs.

The repeatable lifecycle fixture also covered 98 overlapping skills in both
install orders. The project copy was discovered once for each skill. Native local
update, reinstall, ownership-aware migration and rollback preserved unrelated
project content and an isolated private state fixture. Authenticated hooks,
agent tools, Memory Vault, observer shutdown, Windows/macOS and marketplace
distribution remain open. Prepared hooks stay disabled and P13 remains partial.

Official references consulted:

- [Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
- [Creating a Copilot CLI plugin](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)
- [Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
