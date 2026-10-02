# ECC 2.2.1

ECC 2.2.1 is a bug and security patch for ECC 2.2. It keeps the published
`v2.2.0` history immutable. These notes describe the prepared patch; publication
and signing evidence are tracked separately in the release checklist.

## Security and data protection

- GateGuard and governance capture recognize destructive PowerShell commands,
  including the native PowerShell tool path. Dynamic command handling prevents
  later variable assignments from concealing earlier unresolved invocations
  ([#2961](https://github.com/affaan-m/ECC/pull/2961)).
- Relative GateGuard exemption globs stay within the project root. Explicit
  absolute exemptions remain supported
  ([#2921](https://github.com/affaan-m/ECC/issues/2921)).
- Installer writes reject collisions with untracked user-owned files. Failed
  installs refresh ownership hashes only for files they actually wrote, preserving the previous
  ownership hashes of untouched managed files
  ([#2964](https://github.com/affaan-m/ECC/issues/2964)).
- Guided setup revalidates its preview before ownership filtering, so files
  appearing between preview and apply cause a clear retry instead of a false
  success. Existing identical user files stay outside ECC ownership.
- Uninstall respects `ECC_DRY_RUN=1`, including legacy Codex paths, and rejects
  invalid dry-run values instead of silently allowing deletion
  ([#2952](https://github.com/affaan-m/ECC/issues/2952)).
- Observer analysis retains observations on unsuccessful or unconfirmed
  processing. Exit code zero alone no longer permits archival
  ([#2971](https://github.com/affaan-m/ECC/pull/2971)).
- The Yarn lockfile updates `toml` to 4.3.0, matching the npm lockfile and
  removing the affected older resolution.

## Hooks and installation

- Manual Claude installs register ECC-owned hook entries in Claude settings.
  Repair, consent changes, and uninstall reconcile those entries while
  preserving unrelated settings. Atomic settings updates check directory
  identity and retry detected concurrent edits
  ([#2992](https://github.com/affaan-m/ECC/pull/2992)).
- Direct hook entrypoints handle larger JSON payloads with bounded, UTF-8-safe
  reads instead of silently truncating valid inputs. Existing production
  wrapper limits remain unchanged
  ([#2924](https://github.com/affaan-m/ECC/issues/2924)).
- The Pi adapter selects an actual Node runtime instead of recursively
  executing a compiled OMP host as Node
  ([#2909](https://github.com/affaan-m/ECC/issues/2909)).
- Installer listing and control-pane help avoid eager third-party dependency
  loading. Features that require absent runtime packages report the missing
  dependency explicitly
  ([#2994](https://github.com/affaan-m/ECC/pull/2994)).
- Autonomous harness setup documentation replaces nonexistent package names
  and unsupported CLI flags with documented interfaces, and distinguishes
  session scheduling from a durable external scheduler
  ([#2957](https://github.com/affaan-m/ECC/issues/2957)).

## Installer and release-surface hardening

- Public and packaged install docs now consistently point at the published
  `ecc-universal` commands instead of stale or unrelated package names.
- The AdaL adapter docs use the correct `npx ecc-universal doctor --target adal`
  command.
- Claude setup preflights `git` before provider-specific work starts, so missing
  prerequisites fail fast with the right action.
- Guided setup dry runs use isolated HOME, config, XDG, temp, and Windows app
  data roots to avoid ambient host state affecting review or tests.
- The exact packed artifact now has stronger lifecycle coverage for Claude and
  Kimi setup, update, doctor, repeat install, uninstall, and dry-run flows.
- Identifier regression coverage blocks stale `ecc`, `ecc-install`, and other
  mismatched release-path commands from creeping back into user-facing docs.

## Current-main documentation included in this patch

- The canonical Itô workflow now documents `ecc ito accept <ticket-id>` and the
  `ito_accept` MCP tool.
- Acceptance is explicitly bounded to buyer-authority routing. It routes the
  active desk quote to human review and does not claim to place a trade.

## Provenance boundary

- `v2.2.1` is intended to be a signed annotated tag on exact green `main`.
- `v2.2.0` remains the immutable historical unsigned exception. Do not move,
  recreate, or reuse that tag.

## Scope and limitations

- Plugin dependency handling does not bundle or automatically install missing
  modules. Database and schema-validation features require their declared
  runtime dependencies.
- Ownership protection covers untracked collisions and failed-install
  checkpoints. Successful upgrades retain the existing contract for replacing
  previously managed files. Back up intentional edits before upgrading.
- This patch does not introduce new harness platforms or claim that every
  open community issue is resolved.

## Upgrade

After the release workflow publishes 2.2.1 and verifies registry integrity,
install or update the package, then run the same ECC command path you already
use. Until publication completes, the exact-version command below returns E404.

```bash
npm install -g ecc-universal@2.2.1
ecc doctor
```

For first-time or guided terminal setup:

```bash
npx ecc-universal setup
```

The native Claude marketplace path remains supported:

```text
/plugin marketplace add https://github.com/affaan-m/ECC
/plugin install ecc@ecc
```
