# ECC × Itô Real CLI Bridge — TDD Evidence

Date: 2026-07-23

Source plan: requirements were derived from the approved implementation
handoff. No external plan file was executed.

## User journeys

1. As an ECC operator, I can invoke the canonical local Itô `auth`, `find`, and
   `status` operations without a duplicate client or browser workflow.
2. As a security reviewer, I can prove unsupported operations, missing local
   installs, and ECC dry-run requests fail before any child process or network
   operation.
3. As an agent-harness user, I can install one truthful skill that names only
   the real CLI commands and MCP tools.

## RED evidence

Before production changes:

```text
node tests/scripts/ito-cli-bridge.test.js
Passed: 0
Failed: 9

node tests/ci/ito-compute-skill.test.js
Passed: 0
Failed: 4
```

The failures were caused by the old browser-only `rent` command and the missing
real skill/install/MCP surfaces.

## GREEN evidence

```text
node tests/scripts/ito-cli-bridge.test.js
Passed: 9
Failed: 0

node tests/ci/ito-compute-skill.test.js
Passed: 4
Failed: 0

NODE_PATH=<existing-ecc-checkout>/node_modules \
  node scripts/ci/validate-install-manifests.js
Validated 33 install modules, 80 install components, and 7 profiles

npm test
Total Tests: 3159
Passed: 3159
Failed: 0

npm run coverage
Statements: 89.21%
Branches: 79.71%
Functions: 93.96%
Lines: 89.21%

npm run security:ioc-scan
Supply-chain IOC scan passed
```

The isolated worktree temporarily reused the canonical ECC checkout's existing
`node_modules` through an untracked local symlink. The symlink was removed
after validation; no dependency installation or source change was made in the
canonical checkout.
ESLint and Markdown lint also pass for every changed source file. The complete
package dry-run contains the wrapper, environment boundary, skill, and MCP
configuration.

## Test specification

| Guarantee | Test | Type | Result |
|---|---|---|---|
| Only `auth`, `find`, and `status` spawn | `tests/scripts/ito-cli-bridge.test.js` | end-to-end process contract | PASS |
| Full RFQ arguments cross unchanged | `tests/scripts/ito-cli-bridge.test.js` | integration | PASS |
| Only required Itô settings cross the child boundary | `tests/scripts/ito-cli-bridge.test.js` | security integration | PASS |
| Unsupported and dry-run operations fail before spawn | `tests/scripts/ito-cli-bridge.test.js` | negative end-to-end | PASS |
| Missing/relative executables fail with exact local guidance | `tests/scripts/ito-cli-bridge.test.js` | negative end-to-end | PASS |
| Child output and exit code are preserved | `tests/scripts/ito-cli-bridge.test.js` | end-to-end process contract | PASS |
| Skill, package, manifests, and MCP template agree | `tests/ci/ito-compute-skill.test.js` | repository contract | PASS |

## Known gaps

- No live Itô API, RFQ, browser, GPU node, or paid operation was invoked.
- No live GPU qualification was performed.
- The CLI remains locally built and unpublished.

## Merge evidence

No TDD checkpoint commits were created because the implementation handoff
explicitly prohibited commits. The working-tree diff and this report preserve
the RED/GREEN evidence instead.
