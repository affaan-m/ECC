# TESTS.md — Test Assets and Required Test Points

> This registry answers: What tests exist? Which rules require protection? Where is the evidence?
> Aggregate assets by module or workflow rather than mirroring every test function. Test code is executable truth; this document stores only indexes, assessments, and evidence.

## 1. Test Entry Points

| Execution group | Command | When to run | External dependencies |
|---|---|---|---|
| Default tests | `TODO` | Before each commit / CI | None or unverified |
| Contract validation | `TODO` | Contract changes / CI | Contract tooling |
| Consumer contract tests | `TODO` | Client or consumer changes | `TODO` |
| Provider contract tests | `TODO` | Server or provider changes | `TODO` |
| Specialized E2E | `TODO` | Critical path or pre-release | `TODO` |

## 2. Test Asset Map

Controlled levels: `unit`, `integration`, `contract`, `E2E`, `smoke`.

Controlled purposes: `rule protection`, `critical path`, `regression protection`, `specialized protection`. Separate multiple purposes with commas.

| Module or workflow | Level | Purpose | Execution group | External dependencies | Test location | Assessment |
|---|---|---|---|---|---|---|
| Example: order total calculation | unit, integration | rule protection | default tests | none | `tests/order/` | required |
| Example: successful payment path | E2E | critical path | specialized E2E | payment sandbox | `tests/e2e/payment/` | missing |

Assessment values: `required`, `missing`, `possibly duplicate`, `possibly stale`. The last two require human confirmation and do not authorize deletion.

## 3. Cross-Boundary Contract Evidence

Use only when clients and providers develop independently. Reference the single contract source; do not duplicate field definitions here.

| Interface or message boundary | Single contract source | Contract validation | Consumer evidence | Provider evidence | Integration evidence | Assessment |
|---|---|---|---|---|---|---|
| Example: order detail API | `TODO: OpenAPI / JSON Schema / GraphQL / protobuf path` | command + exit code | generated type/mock + test command | serialized-response validation command | minimum E2E command | missing |

Assessment values: `missing`, `covered`, `not applicable`, `unverifiable`. Separate green consumer and provider tests remain `missing` or `unverifiable` unless both reference the same contract.

## 4. Required Test Points

State values: `missing`, `in progress`, `covered`, `not applicable`.

### TEST-ORDER-001 — Order Amount Rule

- State: missing
- Purpose: rule protection
- Source: requirement / business rule / risk / bug identifier
- Representative input: the minimum realistic input that triggers the rule
- Observable expectation: a result that can be asserted without copying the source criteria
- Level: unit
- Execution group: default tests
- Boundary: amount calculation runs for real; no external system
- Test file: TODO
- Test node: TODO
- Command: TODO
- Evidence: TODO

### TEST-BUG-001 — Defect Regression Protection

- State: missing
- Purpose: regression protection
- Source: BUG-001
- Real failure shape: original input, path, and boundary condition that caused the defect
- Observable expectation: behavior that must remain true after the fix
- Level: integration
- Execution group: default tests
- Boundary: core logic runs for real; external services use the project's existing fake
- Test file: TODO
- Test node: TODO
- Command: TODO
- Before-fix evidence: TODO
- After-fix evidence: TODO

### TEST-API-001 — Cross-Boundary Interface Contract

- State: missing
- Purpose: rule protection, critical path
- Source: interface requirement / contract change / field-drift bug
- Single contract source: path plus version, commit, or hash
- Observable expectation: consumer and provider obey the same field names, types, nullability, enums, and error shape
- Level: contract, E2E
- Consumer command and evidence: TODO
- Provider command and evidence: TODO; must validate the actual serialized boundary
- Integration command and evidence: TODO
- Unverified boundaries: TODO

## 5. Manual Verification Exits

Use only when automation is genuinely unavailable. “Hard to test” is not a reason.

| Source | Why automation is unavailable | Manual steps | Passing evidence | Owner |
|---|---|---|---|---|
| TODO | TODO | TODO | TODO | TODO |

## 6. Current Gaps and Actions

| Priority | TEST-ID or asset | Gap | Next action | State |
|---|---|---|---|---|
| P0 | TODO | TODO | TODO | missing |

## 7. Maintenance Triggers

- Test directories, configuration, CI, or standard entry points change: rescan the affected area.
- A requirement, business rule, risk, or bug is added: create or link a TEST-ID.
- A major feature, interface, or security boundary changes: rescan the affected critical path.
- A cross-boundary contract changes: revalidate the contract, regenerate consumer assets, and rerun consumer, provider, and integration tests.
- Before stage delivery: reconcile TEST-IDs and evidence touched by the change.
- Rescan the entire test system only after a testing-system rebuild or when the map is clearly stale.
