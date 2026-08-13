---
name: change-impact
description: >-
  Perform evidence-backed impact analysis before changing code, data, interfaces, or governance documents, then compare the planned impact with the actual diff after implementation. Covers call paths, data and schema, API contracts, tests, documentation, ADRs, deployment, migration, and rollback. Use for cross-module or high-risk changes, database migrations, authentication, public interfaces, blast-radius questions, pre-change checks, and post-implementation alignment.
---

# Change Impact Analysis

Read-only by default. Prove the impact surface from real dependencies and existing documentation before implementation. Mark unknowns explicitly as `unverified`.

## When to Activate

- Before cross-module, public-interface, data-migration, authentication, deployment, or irreversible changes.
- When the user asks about blast radius, migration risk, rollback, or affected areas.
- After implementation, when the planned impact must be reconciled with the actual diff.

## Anti-Patterns

- Guessing call relationships from directory names or model intuition.
- Turning an impact report into another drifting requirements or architecture document.
- Declaring a high-risk change deliverable without recovery steps, a compatibility window, and an explicit account of irreversible effects.

## Related Skills

- `architecture-decision-records`: hard-to-reverse decisions whose rationale must remain durable.
- `contract-first`: cross-service or cross-client boundary changes.
- `test-collaboration`: verification evidence for success criteria, risks, and defects.
- `module-regression`: downstream regression after implementation.

## Before the Change

Answer in order:

1. **Code**: Which entry points, direct callers, downstream consumers, generated artifacts, and compatibility layers are affected?
2. **Data**: Do schemas, migrations, historical data, serialization, caches, or idempotency keys change?
3. **Interfaces**: Do APIs, messages, file formats, or CLIs change? Who are the consumers and providers?
4. **Tests**: Which success criteria, TEST-IDs, contract tests, and regression commands should prove the change correct?
5. **Documentation**: Does the change affect MAP, STATUS, LOG, CONTEXT, ADR, CONTRACT, Spec/Plan, TESTS, or REGRESSION artifacts?
6. **Release**: What are the deployment order, compatibility window, data recovery steps, rollback command, and irreversible effects?

Prefer evidence from real imports and calls, routes, schemas, configuration, generators, `git grep`, `git diff`, and executable tests. Do not infer dependencies from directory names.

## Routing Rules

- Architecture, databases, authentication, deployment topology, or long-lived technical strategy: check `architecture-decision-records` and the ADR set.
- Cross-client interfaces: update the single contract source managed by `contract-first`, then plan consumer, provider, and integration evidence.
- Requirements, business rules, risks, or bugs: keep success criteria in the Spec/Issue and use `test-collaboration` to link TEST-IDs.
- Module behavior or dependency changes: run `module-regression` after implementation.
- Database migrations, breaking interfaces, authentication, and production releases: record rollback conditions, recovery steps, compatibility period, and irreversible effects. Treat any missing item as a blocker; do not execute rollback on a human's behalf.

## Output

For small changes, report affected objects, evidence, required verification, documentation updates, and unknowns in the response. For cross-module or high-risk work, first discover the project's existing impact-analysis location from its map or documentation index and confirm before writing there. If no canonical location exists, keep the report in the response unless the user chooses one; do not force `docs/impacts/`.

## Post-Implementation Alignment

After implementation, check:

1. Whether the implementation solves the original problem in the Spec/Issue.
2. Whether the actual diff exceeds the declared scope, and whether any excess was authorized and added to the impact analysis.
3. Whether automated and manual evidence covers the success criteria rather than merely proving that a command ran.
4. Whether CONTEXT, ADR, CONTRACT, TESTS, REGRESSION, MAP, STATUS, and LOG artifacts were synchronized with the actual change.
5. Whether temporary code, compatibility logic, unfinished migration work, or follow-up Issues remain.

Report the alignment result in the delivery response by default. For a requested durable high-risk review, reuse the project's mapped or indexed review location and confirm before writing. If none exists, ask the user to choose one; do not force `docs/reviews/` or create a generic `REFLECTION.md`.
