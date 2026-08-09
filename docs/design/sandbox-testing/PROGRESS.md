# Tier 1 Sandbox Progress

Last updated: 2026-09-08

## Scope

Tier 1 builds on the Tier 0 contracts, routing, probe, report, and restricted
process adapter. It adds disposable rootless Podman containers and an explicit
user-consent terminal flow. It does not add Docker fallback, Microsandbox,
hosted CI execution, or virtual machines.

The router exposes Tier 1 only when the probe verifies a reachable rootless
Podman service. An installed CLI or a machine that merely reports `Running`
does not satisfy readiness.

## User Path

1. Start a rootless Podman machine or service.
2. Run `ecc-sandbox probe --refresh` and verify that the Podman backend is
   ready and rootless.
3. Run `ecc-sandbox run sandbox.yaml --dry-run` to review the selected image,
   limits, mounts, and network policy.
4. Run `ecc-sandbox run sandbox.yaml` to execute in a disposable container.
5. Validate the normalized report and verify that no task container remains.

Interactive terminal access requires explicit consent, inherits the same
container boundary, and records lifecycle evidence.

## Verification

The Tier 0 foundation and Tier 1 container lifecycle have focused automated
coverage for rootless enforcement, containment, timeouts, cleanup, image
identity, portable snapshots, and explicit terminal consent.

Historical hosted evidence on the predecessor branch includes rootless Podman
runs on Ubuntu x86_64 and arm64 plus Debian and Fedora x86_64. Fresh evidence
for this rebased branch is required before merge.

## Deferred Work

Escalation, hosted CI execution, native VM adapters, and execution-fabric
orchestration belong in later PRs. Local Podman is currently unavailable until
its machine health check succeeds; the probe must report that state directly.
