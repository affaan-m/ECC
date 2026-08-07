# ECC × Itô Real CLI Bridge — TDD Evidence

Date: 2026-08-05

Source plan: requirements were derived from the approved implementation
handoff. No external plan file was executed.

## User journeys

1. As an ECC operator, I can explicitly invoke streaming device `login`, then
   use validation-only `auth`, `find`, and `status` without a duplicate client.
2. As a security reviewer, I can prove unsupported operations, missing local
   installs, and ECC dry-run requests fail before any child process or network
   operation.
3. As an agent-harness user, I can install one truthful skill that names only
   the real CLI commands and MCP tools.

## RED evidence

Before production changes:

```text
node tests/scripts/ito-cli-bridge.test.js
Passed: 13
Failed: 8

node tests/ci/ito-compute-skill.test.js
Passed: 2
Failed: 3
```

The failures captured the old combined auth/login surface, legacy-mode API-key
gate, buffered login output, and stale help, skill, MCP, and integration wording.

## GREEN evidence

```text
node tests/scripts/ito-cli-bridge.test.js
Passed: 21
Failed: 0

node tests/ci/ito-compute-skill.test.js
Passed: 5
Failed: 0

node scripts/ci/validate-skills.js
Validated 281 skill directories
```

`node tests/scripts/ito-compute-sponsor.test.js` reached 11 passes and 2 failures;
both failures are setup failures because the current worktree lacks `ajv`.
`node scripts/ci/validate-install-manifests.js` is blocked by the same missing
module. No dependency installation was performed.

## Test specification

| Guarantee | Test | Type | Result |
|---|---|---|---|
| `login`, `auth`, `find`, and `status` forward only their reviewed surfaces | `tests/scripts/ito-cli-bridge.test.js` | end-to-end process contract | PASS |
| Login output streams before completion and its exit status propagates | `tests/scripts/ito-cli-bridge.test.js` | async process contract | PASS |
| `auth --no-browser` fails before spawn | `tests/scripts/ito-cli-bridge.test.js` | negative process contract | PASS |
| Full RFQ arguments cross unchanged | `tests/scripts/ito-cli-bridge.test.js` | integration | PASS |
| Login scrubs the API key; auth/find/status forward it directly; evals stays isolated | `tests/scripts/ito-cli-bridge.test.js` | security integration | PASS |
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
