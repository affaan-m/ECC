---
name: test-collaboration
description: "Inventory and govern a project's test assets. Connect requirements, business rules, risks, bugs, and cross-boundary contracts to stable TEST-IDs and executable evidence in the repository's existing test registry or TESTS.md. Use for test inventory, test gap analysis, unit/integration/contract/E2E/smoke classification, bug-to-test regression protection, consumer/provider contract testing, test-necessity review, and pre-delivery evidence review."
---

# Test Collaboration Governance

## When to Activate

- Inventorying test assets, test gaps, or the standard test entry point.
- Giving a requirement, business rule, risk, or important defect durable verification evidence.
- Enabling frontend/backend or multiple services to develop and test independently against one machine-readable contract.

## Anti-Patterns

- Mirroring every test function or copying business success criteria into the registry.
- Treating test count, file existence, or green CI as sufficient behavioral evidence.
- Deleting, weakening, or quarantining tests merely to get green without recording the risk and an explicit manual exit.

## Related Skills

- `ai-regression-testing`: turn important defects into executable regression tests.
- `contract-first`: establish the shared machine-readable contract for consumers and providers.
- `module-regression`: run regression commands for changed modules and downstream consumers.
- `living-docs-governance`: synchronize stage outcomes and append history.

## Goal

Use the repository's existing test-registry document or the `tests` role in `.governance/docs-map.json`. Create the default `TESTS.md` only when no equivalent exists. Govern two kinds of information:

1. **Existing test-asset map** — what tests exist, where they run, and what they protect.
2. **Required test-point registry** — which requirements, rules, risks, and bugs require protection, and whether the current evidence is sufficient.

The registry owns why something must be tested, what behavior matters, and where evidence lives. Test code remains the executable fact. Do not mirror every test function.

## Responsibility Boundary

| Asset | Single responsibility |
|---|---|
| Test registry (`TESTS.md` or equivalent) | Test assets, required test points, gaps, state, and evidence |
| Test code | Executable inputs, assertions, fixtures/fakes, and boundary simulation |
| Regression ledger | Module downstream consumers, commands, and rerun rules; references TEST-IDs only |
| Spec/Issue | Single source for success criteria, problem statement, impact, priority, task state, and schedule |
| Project history | Append-only test-status changes and delivery outcomes, not a copy of the registry |

Version 1 is executed by the current session. It does not add a dedicated agent, slash command, or mandatory generator.

## Read Before Starting

Read artifacts only when they exist:

1. The existing test registry and `templates/TESTS.example.md`.
2. Project rules and maps, such as `CLAUDE.md`, `AGENTS.md`, and `CLAUDE_MAP.md`.
3. Test directories, test configuration, CI configuration, standard runners, and specialized suites.
4. Specs, bugs, Issues, audits, incidents, and regression ledgers. Link success criteria; do not copy them.
5. The regression ledger, to align module commands with TEST-IDs.
6. Machine-readable cross-boundary contracts and their generation/validation entry points, such as OpenAPI, JSON Schema, GraphQL schema, or protobuf.

Preserve existing frameworks, naming, and layout.

## 1. Inventory Existing Test Assets

Perform a full inventory on first adoption, then maintain it incrementally:

1. Find standard entry points such as `pytest`, `npm test`, `make test`, or project scripts.
2. Inspect test directories, configuration, and CI. Collect/list modes are allowed; do not perform risky external operations merely to inventory tests.
3. Aggregate by module, suite, or critical workflow. Do not hand-copy every test function.
4. Record level, purpose, execution group, external dependency, location, and current assessment.
5. Classify assets as required, missing, possibly duplicate, or possibly stale. Inventory reports candidates; it does not delete or rewrite tests.

Rescan by event, not by calendar:

- First registry: full scan.
- Test directory, configuration, CI, or standard entry changes: rescan the affected area.
- New or updated TEST-ID or bug: reconcile the related module.
- Major feature, interface, business-rule, or security-boundary change: rescan the affected path.
- Delivery or governance closeout: reconcile entries touched by the change.
- Full rescan only when the testing system was rebuilt or the map is clearly stale.

## 2. Convert Requirements, Rules, and Risks into TEST-IDs

Use a stable ID such as `TEST-ORDER-001`. Record at least:

- state: `missing`, `in progress`, `covered`, or `not applicable`;
- source requirement, rule, risk, bug, or incident;
- representative input and observable expected behavior;
- level and purpose;
- execution group and real/simulated boundary;
- test file, test node, and executable command.

The source must link to the original success criteria in the Spec/Issue. The registry answers “which evidence verifies this?” and must not create a second drifting statement of the business criteria. If the criteria are ambiguous, return to requirement clarification or ask the owner; do not guess.

Controlled levels: `unit`, `integration`, `contract`, `E2E`, `smoke`.

Controlled purposes: `rule protection`, `critical path`, `regression protection`, `specialized protection`. Separate multiple purposes with commas instead of inventing new values.

`not applicable` requires a reason, such as a schema, type-system, or lint rule providing a more appropriate deterministic guard. “Hard to test” is not a reason.

## 3. Convert Bugs into Regression Protection

Every bug fix must do one of the following:

1. create or link a TEST-ID; or
2. record why automation is not currently possible, plus manual verification steps and evidence.

The TEST-ID must reproduce the real failure shape rather than an easier similar input. Record before-fix failure and after-fix success. If the old code cannot be run, record the reproduction basis and what remains unverified.

Without a TEST-ID or an explicit manual exit, the defect is not fully closed.

## 4. Drive Cross-Boundary Tests from One Contract

When clients and providers develop independently, use the same contract as test input instead of maintaining separate field definitions:

1. Locate the machine-readable contract and record its path and verifiable version, commit, or hash. Do not copy its field table into the test registry.
2. Use one TEST-ID to connect four evidence layers:
   - contract: schema lint or format validation;
   - consumer: generated or contract-validated types, mocks, fixtures, and consumer tests;
   - provider: validate the actual serialized response/message, not only internal DTOs or types;
   - integration: at least one real cross-boundary path, or an explicit recorded gap.
3. Record the actual command, exit code, and evidence location for each layer. Generated types or mocks that are stale or inconsistent with the contract cannot be marked covered.
4. Change the single contract source first, then regenerate consumer assets and rerun provider and integration tests.
5. If no machine-verifiable contract exists, mark the boundary `missing` or `unverifiable` and state the current evidence. Separate green client and server tests do not prove compatibility.

Contract tests prove both sides obey one interface boundary. E2E proves the real business path works. Neither replaces the other.

## 5. Review Test Evidence

Before marking a TEST-ID `covered`, confirm:

1. the test file exists;
2. assertions verify behavior rather than only “called” or HTTP 200;
3. the command runs with exit code 0;
4. the test belongs to the standard runner or a clearly named specialized group;
5. the evidence matches the TEST-ID input, expected behavior, and boundary.
6. the project's configured coverage command passes and records at least 80% coverage; when no trustworthy coverage evidence exists or the threshold is missed, leave the TEST-ID `unverified`.

Files, test counts, and green CI alone do not prove required rules are covered.

Delivery closeout also confirms active Specs/Issues have explicit success criteria; critical criteria link to TEST-IDs or reviewable manual exits; evidence checks the expected behavior; and significant standard or outcome changes were appended to project history.

## Test Design Discipline

- Prefer one discoverable standard test command; isolate slow, networked, and expensive E2E tests in clearly named groups.
- State which E2E components are real and which external systems are faked, including why.
- Use the actual incident input, path, and boundary in defect regression tests.
- Assert relationships and invariants rather than fragile snapshots, fixed enum counts, or version literals.
- Reuse existing fixtures and fakes for common boundaries.
- For critical rules, cover the normal case and a rejection/boundary case, especially permissions, security, configuration propagation, and file/network paths.
- Prefer real imports and temporary-directory integration evidence for parsers, configuration propagation, security boundaries, remote backends, and file/network I/O.
- Consumer types/mocks, provider verification, and integration tests must reference one contract source.
- Provider contract tests inspect the actual serialized shape: names, types, nullability, enums, errors, and large identifiers.
- Adopt the discipline, not another project's infrastructure scale.

## Output

When creating or updating a test-registry artifact, adapt `templates/TESTS.example.md` while preserving the repository's location and naming. Report:

1. standard test entry points and asset overview;
2. counts of required, missing, possibly duplicate, and possibly stale assets;
3. TEST-IDs added or changed;
4. commands actually run, exit codes, and unverified items;
5. only the highest-priority next test actions.

Inventory tasks modify governance documentation only by default. Do not change production code, delete tests, or silently implement missing behavior without separate authorization.
