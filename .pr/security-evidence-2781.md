# Security Evidence — PR #2781

## Changed surface

- `skills/continuous-learning-v2/hooks/observe.sh`
- `tests/hooks/continuous-learning-scope-contract.test.js`
- `tests/hooks/observe-subdirectory-detection.test.js`

## Bounded risk

The hook now takes project scope from the event's usable `cwd`, or from a valid
explicit `CLAUDE_PROJECT_DIR` when the payload has no usable `cwd`. Otherwise it
uses global scope instead of inheriting the hook process directory. Observer
lookup, lazy start, and signaling use the current observation's project PID
file, preventing one project's event from waking or being suppressed by an
unrelated global observer. Stored `cwd` diagnostics are scrubbed.

The diff does not change authentication, credential, billing, or webhook
handling.

## Focused security validation

- `node tests/hooks/continuous-learning-scope-contract.test.js` — passed; the
  source contract checks deterministic fallback and project PID isolation.
- `ECC_TEST_BASH=<Git Bash> node tests/hooks/observe-subdirectory-detection.test.js`
  — 9 passed, 0 failed; covers subdirectory resolution, missing/null `cwd`, and
  explicit project fallback.
- `node tests/hooks/observer-memory.test.js` — 32 passed, 0 failed.
- Git Bash `-n` on `observe.sh` and `start-observer.sh` — passed.
- `npm run security:ioc-scan` — passed; 241 files inspected.
- `npm run context-profiles:check` — passed; 293 skills and 32 profile/target
  projections validated. The skill registry digest was refreshed because this
  registry hashes all resources under each skill directory.
