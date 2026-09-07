# Tier 0 Sandbox Progress

Last updated: 2026-09-07

## Scope

Tier 0 establishes the shared manifest, capability, routing, and report
contracts and implements the restricted SRT process boundary. It does not add
rootless containers, interactive terminal sessions, escalation, native CI, or
virtual machines.

## User Path

1. Write a strict `sandbox.yaml` containing needs and commands, not a backend.
2. Run `ecc-sandbox probe --refresh` to produce the host capability map.
3. Run `ecc-sandbox run sandbox.yaml --dry-run` to validate and explain the
   selected route without executing commands.
4. Run `ecc-sandbox run sandbox.yaml` for a Tier 0-compatible claim.
5. Validate the resulting normalized report with `ecc-sandbox report`.

Tier 0 re-allows the invocation workspace while denying the rest of the user's
home. It passes a bounded environment allowlist and records whether execution
was real or mocked. It is a host process boundary, not clean-user or fresh-OS
evidence.

## Verification

The Tier 0 contract, router, capability probe, SRT adapter, report validation,
and npm publish surface have focused automated coverage. A real macOS SRT run
previously demonstrated both a benign execution and a denied outside-workspace
write with no leaked file.

## Deferred Work

Tier 1 rootless Podman execution and its explicit user-consent terminal flow
belong in the stacked Tier 1 PR. Escalation, hosted CI execution, native VM
adapters, and execution-fabric orchestration are separate future work.
