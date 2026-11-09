# Experimental Copilot plugin artifact

This is P13 source preparation. M1 and M2 are incomplete. The project installer
remains the usable automation path; generated plugin hooks are deliberately
disabled until native root expansion and session behavior have acceptance proof.
See the [format ADR](design/adr-copilot-plugin-format.md).

Build from the reviewed checkout into a **new absolute directory outside it**:

```text
node scripts/copilot-plugin.js build --output /absolute/new/ecc-plugin-artifact
node scripts/copilot-plugin.js verify --artifact /absolute/new/ecc-plugin-artifact
node scripts/copilot-plugin.js preview --artifact /absolute/new/ecc-plugin-artifact --project /absolute/project
```

The builder uses the same full-profile Copilot installation plan, transforms and
runtime closure in an empty staging project. It produces a root `plugin.json`,
portable `skills`, Copilot agent/rule/hook directories, bundled runtime helpers
and an `ecc-artifact.json` digest inventory. Bundled scripts declare their own
CommonJS package scope so an ancestor ESM package cannot change how they load.
No developer home, private store,
install receipt, Git history or `node_modules` is copied. Existing output is
refused; inspect/remove an old artifact explicitly before choosing a new build.

The module API can select `moduleIds` for fixture builds. It can also check a
specified `projectRoot`; an existing ECC install receipt or hook file causes an
explicit coexistence rejection. Output publication assumes a trusted parent
directory and cooperative filesystem writers. Keep the source and output stable
during build and verification. `verify` checks the recorded file sizes and
digests, missing or unlisted files, links, and the disabled hook manifest. The
inventory is an integrity check for a trusted artifact and has no signature.

For local CLI loading, use an isolated Copilot configuration and a disposable
project. The observed 1.0.105 commands are:

```text
copilot plugin install /absolute/new/ecc-plugin-artifact
copilot plugin list --json
copilot skill list --json
copilot plugin disable ecc-copilot
copilot plugin enable ecc-copilot
copilot plugin update ecc-copilot
copilot plugin uninstall ecc-copilot
```

Local direct installation is deprecated by CLI 1.0.105. A local update reads the
source directory recorded at installation. Keep that source available and
verify the new artifact before replacing a local test source or reinstalling
from a new directory. For marketplace distribution, place the verified artifact
at the plugin directory listed in the reviewed marketplace manifest, then test
`copilot plugin marketplace add <source>` and
`copilot plugin install ecc-copilot@<marketplace>` with an isolated configuration.
Marketplace installation and publication remain untested.

The initial full Linux fixture installed and discovered 389 generated skills.
The repeatable `commands-core` fixture uses 98 skills to exercise both install
orders. CLI 1.0.105 discovered each overlapping skill once and used the project
copy in both orders. The fixture also verified disable/enable, local update from
2.2.3 to a synthetic 2.2.4, uninstall/reinstall, and preservation of the project
receipt and a private state fixture. These commands run without an account.

## Runtime paths and coexistence

Skill helper commands contain a quoted `<ECC_PLUGIN_ROOT>` placeholder and
explicit instructions for deriving the actual root from the discovered skill's
source path. It must be resolved before execution; it is not automatically
expanded by a shell. A project-local `.github/ecc` runtime must not be substituted.
Project working directories remain separate from the artifact root.

Prepared hooks reference the bundled `copilot-plugin-hook.js` launcher. That
launcher uses its own file location, an exact entrypoint allowlist, bounded
stdin/subprocess output and the existing runtime. A pre-tool launcher error
returns a deny; optional event failure returns a diagnostic without granting
permissions. Canvas, native skill telemetry and the evidence collector use
project-only hook wiring. Native outer host timeouts still follow host semantics.

The launcher refuses execution alongside a project ECC receipt or `ecc.json`.
`preview` reports those markers and collisions with the projected skill, agent
and rule paths. A conflict can include user-owned files. The command reports
paths for review and performs no write. For a reviewed project-to-plugin migration
in a disposable environment, run the existing ownership-aware uninstaller from
the project directory using the ECC checkout's script:

```text
node /absolute/ECC/scripts/uninstall.js --target copilot --dry-run --json
node /absolute/ECC/scripts/uninstall.js --target copilot --json
```

Run the second command only after reviewing the removal plan. The uninstaller
preserves modified or unverifiable files and reports a partial result if any
remain. Rerun `preview` before proceeding and resolve retained collisions with
their owner. For rollback, uninstall the plugin and rerun the project installer
with the previous selection and hook consent. The native fixture exercises this
migration and rollback with its isolated project and verifies that unrelated
user content survives.

P13 still needs authenticated native hook root expansion and delivery from a
relocated CLI cache, model resolution of bundled helper paths, agent/rule
behavior, and one policy execution per event with an active installation.
Worker shutdown on plugin disable and MCP coexistence require dedicated
verification before they can be activated. Windows and macOS and marketplace
update/rollback remain pending. Keep `disableAllHooks` enabled in the generated
artifact until those acceptance gates pass.

## Verification and rollback

```text
node tests/lib/copilot-plugin.test.js
node tests/fixtures/copilot-plugin-lifecycle.js /absolute/copilot
```

The unit tests cover declared-operation packaging, artifact verification,
collision preview, checkout isolation, output preservation and a moved artifact
executing a guard from a separate directory with spaces. The opt-in native
fixture uses a temporary project and a separate `COPILOT_HOME`. It passes no
account credentials and cleans up its own files. The command accepts an absolute
path to a CLI executable or a Node launcher.

Disable/uninstall only the experimental plugin to roll back loading. The
project installation and private checkpoint/learning/Vault stores are independent.
No hook, worker or MCP server starts during build or local installation of the
default artifact because prepared hooks are disabled and no MCP is activated.
