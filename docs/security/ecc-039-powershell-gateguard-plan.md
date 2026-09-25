# ECC-039 PowerShell GateGuard and Audit Alignment Plan

## Status

- Ticket: ECC-039
- Size: large
- Priority: critical
- Baseline: `origin/main` at `e04ea0b9`
- Source to salvage: PR #2721 at `4a2e59ba`
- Implementation state: implemented in PR #2961 and under hosted verification

The fix spans the security enforcement path, governance evidence, configured
hook routing, post-tool dispatch, and cross-platform regression coverage. It is
large because the stale PR changes eight files, conflicts with current `main`,
and must establish one consistent policy/evidence contract.

## Objective

Make PowerShell a governed arbitrary-command shell with one destructive-command
classification result shared by pre-execution denial and governance evidence.
Every PowerShell command denied as destructive must produce an
`approval_requested` event when governance capture is enabled.

## Verified Current State

Current `main` has no dedicated PowerShell GateGuard route and excludes
PowerShell from governance capture. PR #2721 adds the route and most of the
detector, but its exact head still has these reproduced mismatches:

| Command class | PR #2721 GateGuard | PR #2721 governance |
|---|---|---|
| Direct recursive `Remove-Item` | deny | approval event |
| Destructive command inside `$()` | allow | approval event |
| Force-only `Remove-Item` | deny | no event |
| Wildcard `Remove-Item` | deny | no event |
| `.NET Directory::Delete` | deny | no event |
| `Clear-Content` | allow | approval event |
| `Format-Volume` | allow | approval event |
| Benign `Get-ChildItem` | allow | no event |

The focused PR-head suites pass with 166 GateGuard tests and 35 governance
tests. Those green suites do not cover the mismatches above. A direct
`merge-tree` check against current `main` reports conflicts in
`scripts/hooks/gateguard-fact-force.js` and `tests/hooks/hooks.test.js`.

Applying the stale PR files wholesale would also discard current-main heredoc
filtering, narrow recovery guidance, valid `.*` hook matchers, post-dispatcher
skill tracking, and newer hook tests.

## Prior Art Review

The implementation was informed by existing and merged alternatives before any
production code was changed:

- PR #2721 supplied the original PowerShell route and detection inventory, but
  its conflicted head had GateGuard/governance drift and removed backticks
  before parsing, which changes PowerShell escape meaning.
- PRs #1912 and #2495 established the useful bounded executable-body traversal
  and parser-focused test patterns. Their Bash parser was not reused because
  Bash backslashes and backticks have different semantics from PowerShell.
- PR #2902 showed the safe forward-port pattern used here: retain current-main
  heredoc filtering, narrow recovery hints, and valid `.*` matchers while
  applying only the feature-specific changes.
- PR #2897 reinforced that quoted delimiters must not terminate executable
  ranges and that executable expressions inside double quotes still run.
- PR #2865 and related open work cover separate Bash and hook hardening. Those
  changes remain outside ECC-039 and were not absorbed into this patch.

## Design Decision

Add a pure shared module at
`scripts/lib/powershell-destructive-command.js`. It returns stable,
non-sensitive rule IDs for all matches. GateGuard denies when the result is
non-empty, and governance uses the same result to emit approval evidence.

The module owns PowerShell-specific parsing and policy:

- `Remove-Item`, `Remove-ItemProperty`, and built-in aliases
- `-Recurse` and valid unambiguous abbreviations
- `-Force` without recursion
- wildcard targets and opaque splatted parameters
- pipeline-wide recursion evidence
- `.NET` `Directory::Delete` and `File::Delete`
- `cmd /c` recursive deletion
- nested `powershell` and `pwsh -Command`
- `Start-Process` and static nested-shell argument forms
- UTF-16LE `-EncodedCommand`
- `Clear-Content`, `Clear-Disk`, and `Format-Volume`
- static aliases, functions, script blocks, class construction, and common
  execution primitives
- fail-closed `powershell.dynamic-execution` evidence when an execution
  primitive cannot be resolved safely
- bounded recursion that fails closed after executable nesting exceeds budget

The parser extracts balanced PowerShell `$()` bodies recursively. It treats
subexpressions outside quotes and inside double quotes as executable, ignores
single-quoted literals, respects backtick-escaped dollar signs, and handles
nested parentheses without deleting escape characters before parsing.

GateGuard retains its current Bash classifier. The PowerShell path combines the
existing shell-agnostic destructive classifications with the new shared
PowerShell findings. Governance preserves its current Bash approval behavior
and consumes the shared PowerShell findings for the PowerShell tool.

## Task List

1. Add red classifier and consumer tests.
   - Create `tests/lib/powershell-destructive-command.test.js`.
   - Add identical destructive and benign command tables to the GateGuard and
     governance consumer tests.
   - Prove the direct configured PowerShell route denies a recursive delete,
     while `$()` and evidence-parity cases fail before implementation.

2. Implement the shared PowerShell classifier.
   - Port only the valuable detection behavior from PR #2721.
   - Return stable rule IDs instead of raw command text or a bare boolean.
   - Add quote-aware, nesting-aware `$()` extraction and recursive scanning.
   - Preserve bounded work and conservative failure on opaque executable input.

3. Integrate GateGuard from current `main`.
   - Normalize the `PowerShell` tool name.
   - Add the PowerShell classifier to the existing shell branch.
   - Preserve first-denial and retry state semantics.
   - Emit the PowerShell hook ID in routine denial recovery guidance.
   - Preserve current heredoc stripping, denial dampening, and narrow recovery
     hints.

4. Integrate governance evidence.
   - Add PowerShell to the security-relevant tool set.
   - Emit one `approval_requested` event from the shared findings.
   - Store stable rule IDs and the existing command fingerprint only.
   - Preserve secret redaction and avoid raw command text in events.

5. Wire the configured entry points.
   - Add one dedicated PowerShell PreToolUse GateGuard route to
     `hooks/hooks.json`.
   - Add PowerShell to the pre-governance matcher.
   - Add PowerShell to post-governance dispatch only, keeping Bash-only post
     hooks restricted to Bash.
   - Preserve current `.*` matcher syntax and all current-main routes.

6. Exercise the real hook commands.
   - Run the exact command read from `hooks/hooks.json` for denial and
     governance capture with isolated state and unique sessions.
   - Clear ambient GateGuard opt-out variables in fixtures.
   - Verify the post-tool dispatcher selects governance for PowerShell.

7. Complete review and verification.
   - Run focused unit and hook suites, then the full repository suite and
     coverage.
   - Run a security review for parser bypasses, quote false positives, command
     leakage, recursion-budget behavior, and Bash regressions.
   - Resolve every critical or high finding before commit review.

## Acceptance Matrix

| Command class | GateGuard | Governance evidence |
|---|---|---|
| Recursive `Remove-Item` and aliases | deny first attempt | approval event |
| Force-only `Remove-Item` | deny | approval event |
| Wildcard or splatted delete | deny | approval event |
| `.NET Directory::Delete` or `File::Delete` | deny | approval event |
| `Clear-Content`, `Clear-Disk`, `Format-Volume` | deny | approval event |
| Nested `pwsh -Command` or encoded command | deny | approval event |
| Destructive command in unquoted `$()` | deny | approval event |
| Destructive command in double-quoted `$()` | deny | approval event |
| Recursively nested executable `$()` | deny | approval event |
| Same text in a single-quoted literal | no destructive denial | no event |
| Backtick-escaped literal `$()` | no destructive denial | no event |
| Plain `Remove-Item file.txt` | allow under current policy | no event |
| `Get-ChildItem` or `Get-Date` | allow | no event |
| Existing Bash destructive and heredoc cases | unchanged | unchanged |
| Configured PreToolUse route | command denies | event when enabled |
| Configured PostToolUse route | not applicable | reaches governance |

## Verification

Run in this order:

```sh
node tests/lib/powershell-destructive-command.test.js
node tests/hooks/gateguard-fact-force.test.js
node tests/hooks/governance-capture.test.js
node tests/hooks/hooks.test.js
node tests/hooks/posttooluse-dispatcher.test.js
npm test
npm run coverage
git diff --check
```

Hosted acceptance requires the repository security scan, lint, coverage, and
the supported Node and package-manager CI matrix at the exact proposed head.

## Implementation and Verification Results

The implementation is committed in PR #2961. It adds the shared classifier,
dedicated PowerShell hook routes, exact
GateGuard/governance rule parity, redacted evidence, case-insensitive tool
matching, post-tool governance dispatch, and the review-driven hardening needed
for static variables embedded in nested double-quoted command payloads.

- Focused classifier and hook suites: 531 passed, 0 failed.
- Full repository suite: 4,217 passed, 0 failed.
- Coverage gate: passed at 89.23% statements, 81.28% branches, 94.56%
  functions, and 89.23% lines.
- Supply-chain IOC scan: passed for all 224 inspected files.
- ESLint, Markdown lint, hook validation, personal-path validation, and
  `git diff --check`: passed.
- Independent final security replay: no critical or high findings across 109
  destructive cases, 19 benign controls, 9 elevation cases, and 13
  GateGuard/governance parity cases.
- The 40,000-container, approximately 840 KB stress input completed well below
  the configured five-second hook timeout and preserved the destructive tail
  finding.

PowerShell itself is not installed in the local PATH, so the repository's
native `install.ps1` delegation checks were skipped by their existing runtime
guard. Classifier, configured-hook, governance, and dispatcher behavior were
still exercised through the Node hook boundary.

## Risks and Controls

- PowerShell quoting and backtick semantics can cause bypasses or false
  positives. Use explicit executable and literal pairs for each parser case.
- Short parameter prefixes can become ambiguous. Test only valid prefixes for
  the intended cmdlets and keep rule IDs visible in unit failures.
- Encoded and deeply nested commands can consume unbounded work. Enforce a
  shared recursion budget and fail closed only after executable nesting is
  observed.
- Dynamic execution can hide a command from static inspection. Resolve common
  static forms and return `powershell.dynamic-execution` for unresolved
  execution primitives or shell-launch splats.
- Governance records can leak command content. Reuse the existing fingerprint
  and summary path and assert that emitted events contain no raw command.
- A stale-PR merge can regress current hardening. Port PowerShell hunks manually
  onto `origin/main` and keep current-main regression tests green.

## Roadmap and Scope

This is post-2.2 hardening of the ECC 2 trustworthy substrate. It makes the
policy/evidence seam truthful at configured hook boundaries and prepares for
future evidence contracts while keeping ECC authoritative over policy,
enforcement, canonical evidence, and workflow outcomes.

Out of scope are a general PowerShell parser, exact interpretation of arbitrary
runtime-generated payloads or reflection, broader Bash classifier refactoring,
public API changes, issue #2921 glob semantics, issue #2886 heredoc redesign,
ExecutionCapsule, sandbox tiers, Feature Fleet, Itô, and Nasiko. Unresolved
execution primitives fail closed instead of being interpreted. Current-main
behavior for #2886 remains covered and unchanged.

Known non-bypass residuals are conservative classification of unresolved safe
dynamic execution and `Start-Process` splats, plus whole-class scanning when a
class is activated. Whole-class scanning can flag an uncalled destructive
method when a safe sibling member is invoked. Separating constructor and method
resolution is a precision improvement, not a release-blocking enforcement gap.
