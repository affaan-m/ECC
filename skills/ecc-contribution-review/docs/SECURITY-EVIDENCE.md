# Contribution review security evidence

Recorded 2026-10-17 against the source hashes in
`../tests/security-evidence/source-sha256.json`.
The scanner output is `../tests/security-evidence/bandit.json`.
These are observed local results, not an upstream CI or maintainer approval.

## Scope and results

- Bandit 1.9.4: both compiler modules scanned, zero findings, zero skipped tests,
  no `nosec` suppressions, exit 0.
- Python 3.14.3, pytest 9.1.1, pytest-cov 7.1.0: 45 tests passed,
  including 19 focused security/provenance tests and 8 review regression tests; compiler branch-enabled combined
  coverage 95.79%, above the 80% gate.
- Evidence recorder: 7 provenance regressions passed, 88.68% combined coverage.
- Ruff 0.17.1: changed Python source and tests passed.
- Mypy 2.4.0: compiler passed.
- Workflow security validator: 13 workflows passed.

Security regressions exercise rejected authority escalation, malformed input,
malformed failure probes, non-skill labels, envelope values, impossible numeric
claims, normal and safe-path (`-P`/`-I`) CLI invocation, function/module size policy, non-finite JSON numbers, invalid UTF-8, existing-file and symlink preservation,
output receipt accuracy, canonical/parity record agreement, and non-execution
of supplied runner argv. Source hashes for both compiler modules, all four test modules, the evidence recorder, and canonical
agent metadata are verified by a security regression in CI; stale evidence fails
the job.
Both new agent metadata files are checked for identical
content and absence of extra tool, dependency, or permission configuration.
The metadata retains ECC's existing implicit-invocation convention.

## Reproduce

From the repository root, with the development dependencies and Bandit 1.9.4:

```sh
python skills/ecc-contribution-review/tests/record_security_evidence.py --output security-bandit.json
python -m pytest skills/ecc-contribution-review/tests/ -q --cov=skills/ecc-contribution-review/scripts --cov-report=term --cov-fail-under=80
python -m ruff check skills/ecc-contribution-review/scripts skills/ecc-contribution-review/tests
python -m mypy skills/ecc-contribution-review/scripts/compile_contribution_review.py
node scripts/ci/validate-workflow-security.js
```

The recorder captures the exact source SHA-256 inventory before and after the
pinned Bandit scan, rejects source drift, and embeds that inventory and scanner
version in the report. Regression checks compare embedded hashes directly to
current source bytes and require the scanned metrics inventory to match. A
same-line source edit remains stale even if `source-sha256.json` is refreshed.
Regenerate the committed report with the same recorder and an output path of
`skills/ecc-contribution-review/tests/security-evidence/bandit.json`, then refresh
the separate source manifest after all source/test/recorder edits.

The Security Scan CI job now reruns this recorder and the focused security regressions.
It fails on any scanner finding or failed regression, and uploads machine-readable
Bandit JSON and JUnit results as `contribution-security-evidence` even on failure.

## Limits

Embedded provenance records which source bytes were scanned; it is not a
cryptographic attestation against deliberate evidence editing. CI independently
reruns the pinned scanner and fails on findings, errors, or source drift.
Bandit checks Python source patterns; the configuration regression checks the
supported metadata boundary. Neither proves absence of every security defect.
Observation content and evidence references remain unverified claims and cannot
grant authority. The compiler writes only a newly created requested output file;
reviewers must still authorize any later execution of proposed commands.
