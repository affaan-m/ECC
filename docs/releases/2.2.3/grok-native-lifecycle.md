# Grok native lifecycle evidence

The adjacent [JSON receipt](grok-native-lifecycle.json) records a real local run
on Linux x64 with Grok Build 1.0.62 and Node 24.21.0. Its `commit` identifies
the checked-out ECC code and acceptance driver; `sourceDirty: false` binds the
run to committed files. The receipt includes the Grok executable SHA-256,
command exit codes, compact native inspection results, and immutable fixture
commit IDs. This is local acceptance evidence for PR #2856.

## Reproduce

Install Grok separately, put its executable on `PATH`, and run from a checkout:

```bash
node tests/ci/grok-native-lifecycle.js --report /tmp/grok-native-lifecycle.json
```

The opt-in driver exits nonzero if Grok is unavailable, a command fails, or any
assertion fails. It does not silently skip native checks. Ordinary JS tests may
run without Grok; the driver sets `ECC_REQUIRE_GROK_NATIVE=1` and requires eight
successful native readbacks from the canonical install suite.

It creates disposable HOME, USERPROFILE, GROK_HOME and XDG directories and
passes only `PATH` plus those isolation and test settings. No user credentials,
proxy settings or provider configuration are inherited. The isolated project
must start with no discovered skills, hooks or MCP servers. Each command has a
deadline and bounded output; the driver's temporary root is removed on exit.

## Checked scenarios

| Scenario | Observable assertion |
| --- | --- |
| Trusted install | Real `grok plugin install --trust`, `plugin list --json` and `inspect --json` discover ECC skills; the native manifest keeps hooks/MCP disabled. Canonical trust plus explicit consent enables the requested capabilities. |
| Untrusted install | Native noninteractive install without `--trust` exits 1 and leaves no plugin. Canonical untrusted plans omit hooks/MCP even when requested. |
| Hook denial | Canonical hook denial with an independently consented MCP server yields no hooks and exactly one MCP server in native inspection. |
| MCP denial | Canonical MCP denial with consented hooks yields hooks and zero MCP servers in native inspection. |
| Disabled plugin | Native disable removes ECC from discovered skills; enable restores it. |
| Missing root | Moving the isolated installed root removes ECC from discovered skills; restoring it restores discovery. The adapter also resolves missing roots to null. |
| Upgrade | Real native Git update advances the full ECC fixture to its second commit. Canonical upgrade changes the full ECC payload and native capability inventory. |
| Uninstall | Native uninstall removes the registry entry, Git snapshot and discovered ECC components. Canonical uninstall removes its receipt and installed tree. |
| Rollback | Explicit native Git reinstall at the first SHA restores the first version and marker. Canonical rollback restores the recorded SHA, payload and consented capabilities, then native inspection confirms discovery. |
| Immutable pin | Native update of a pinned plugin reports skipping and preserves the exact SHA. Canonical installs ignore dirty/untracked working-tree content and repair retains the receipt's revision after catalog changes. |

## Fixture and evidence boundaries

Native Git transitions archive the complete ECC `commit` into a new local Git
repository. They add one marker skill and use a synthetic next-patch prerelease
version for the second commit. `baseSourceCommit`, `firstCommit` and
`secondCommit` distinguish the reviewed source from these disposable commits.
The driver verifies registry commit/ref, manifest version, marker contents,
`scripts/grok-install.js`, and canonical skill files after each transition.
These synthetic versions are not ECC releases. Git transport uses local
`file://` URLs; remote GitHub availability and marketplace publication are not
certified by this run.

The native local-path update reports “local symlink, already live.” The Git
fixture separately verifies actual snapshot updates. Native Git rollback here
means uninstall plus explicit reinstall at a prior SHA; Grok exposes no
dedicated rollback subcommand in this version. ECC rollback uses its canonical
apply path with an explicit source SHA.

Grok 1.0.62 still reports `plugin.enabled: true` in the plugin inventory after
disable even though ECC skills disappear from the loaded skill inventory.
The acceptance assertion checks the loaded components and records the plugin
inventory discrepancy; it does not treat that flag as proof of loading.

This run checks native discovery and lifecycle behavior. It does not invoke a
model, dispatch a hook, connect to an MCP server, or claim Windows/macOS native
coverage. The eight adapter tests and eleven canonical tests are separate from
the native CLI commands enumerated in the receipt. A maintainer or CI runner
can rerun the driver and retain its JSON as an artifact bound to that run's
commit; the checked-in receipt records this specific machine and version.
