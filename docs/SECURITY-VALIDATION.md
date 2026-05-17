# Security Validation

This fork carries a small security validation layer from upstream, adapted to the existing `scripts/node/ci/` layout.

## Checks

| Script | Purpose |
|--------|---------|
| `scripts/node/ci/validate-workflow-security.js` | Reject unsafe GitHub Actions checkout, cache, audit, and install-script patterns |
| `scripts/node/ci/validate-no-personal-paths.js` | Prevent shipping user-specific absolute paths in docs, agents, commands, rules, and skills |
| `scripts/node/ci/scan-supply-chain-iocs.js` | Scan manifests, lockfiles, configs, and package payloads for active supply-chain indicators |
| `scripts/node/ci/supply-chain-advisory-sources.js` | Build and validate the advisory source registry used by supply-chain checks |

## Local Verification

```bash
node scripts/node/ci/validate-workflow-security.js
node scripts/node/ci/validate-no-personal-paths.js
node scripts/node/ci/scan-supply-chain-iocs.js
node tests/ci/validate-workflow-security.test.js
node tests/ci/no-personal-paths.test.js
node tests/ci/scan-supply-chain-iocs.test.js
node tests/ci/supply-chain-advisory-sources.test.js
```

The workflow validator is intentionally strict. If a workflow gains write permissions, checkout must use `persist-credentials: false`. Package-manager installs in workflows must disable lifecycle scripts.
