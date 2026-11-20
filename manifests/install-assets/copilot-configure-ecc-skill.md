---
name: configure-ecc
description: Inspect, preview, and repair the managed ECC installation in the current GitHub Copilot CLI project. Use when checking install health or changing the selected ECC skills and modules.
metadata:
  origin: ECC
---

# Configure ECC in GitHub Copilot CLI

Work from the current project root with the `ecc` executable from a trusted, already installed `ecc-universal` package. For a project-local npm installation, substitute `node node_modules/ecc-universal/scripts/ecc.js` for `ecc`. Stop and report that the local ECC CLI is required if neither entry point is available. Keep this process local.

## Inspect the project

```sh
ecc list-installed --target copilot --json
ecc doctor --target copilot --json
```

Summarize the recorded selection and drift. An empty inventory means there is no managed Copilot project installation. Stop for invalid or ambiguous state and report the diagnostics. The managed target is the current project's `.github` directory.

## Preview a selection or repair

Use the recorded selection as the starting point for reconfiguration. Retain all selected skills and modules the user wants to keep. For example, this previews a clean installation of this skill with hooks declined:

```sh
ecc install --target copilot --skills configure-ecc --no-hooks --dry-run --json
```

For an existing installation with drift, preview repair of its recorded selection:

```sh
ecc repair --target copilot --dry-run --json
```

Summarize the managed paths and scope from the preview. Keep the recorded hook decision. If a selection preview would change it, stop and report the mismatch.

## Confirm, apply, and verify

Obtain explicit confirmation of the preview before making changes. Run the same operation without `--dry-run`, then repeat the inventory and doctor commands. Report errors and unmanaged conflicts as returned by the CLI. A successful doctor check verifies managed files, while Copilot's native skill discovery needs a project session check.
