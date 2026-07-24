---
name: contract-first
description: Use when multiple consumers and providers must evolve an API or event schema without field drift, integration surprises, or one side silently redefining the interface.
metadata:
  origin: ECC
---

# Contract-First Collaboration

Coordinate frontend/backend or service-to-service work through one authoritative,
machine-checkable contract. Consumers state what they need, providers implement
that shape, and both sides verify against the same artifact before integration.

This skill governs how teams change a boundary. It complements `api-design`,
which governs what a good API looks like, and `ai-regression-testing`, which
guards fixed bugs from returning.

## When to Activate

- Frontend and backend work will proceed in parallel.
- Two or more services exchange API payloads, events, or commands.
- Field names, nullability, enums, or error shapes regularly drift.
- One consumer needs several calls because the provider exposed storage models
  instead of a task-oriented response.
- A provider change can break consumers maintained by another person or agent.
- Mock responses and production responses no longer have the same shape.

Do not add contract machinery to a single-module boundary that changes in one
atomic commit and has no independent consumer. A shared type may be enough.

## The Boundary Artifact

Choose one canonical, version-controlled artifact for each boundary:

- OpenAPI for HTTP APIs
- AsyncAPI for event-driven APIs
- Protocol Buffers for RPC or message schemas
- JSON Schema for standalone payloads
- A typed interface only when every participant shares the same build and
  runtime compatibility model

The filename is not important. Authority is. Do not maintain the same payload
shape independently in a wiki, prose document, mock file, and provider code.

The artifact must define the observable behavior consumers depend on:

- operation or event name
- request and response shapes
- required and optional fields
- nullability and defaults
- enum values
- error responses
- compatibility or versioning rules

Keep implementation details out. Database columns, internal classes, and query
plans are not part of the contract unless consumers can observe them.

## Consumer-First Workflow

### 1. Identify Consumers and Owners

Record:

- who consumes the boundary
- who owns the provider
- who may approve contract changes
- which artifact is authoritative

One owner resolves ambiguity; ownership does not mean the provider designs the
contract alone.

### 2. Describe Consumer Jobs

Start from what each consumer must render or accomplish. Ask:

- Which fields are actually required?
- What do missing, empty, and null mean?
- Which identifiers must remain strings?
- Which enum values can the consumer handle?
- Can one task-oriented response replace several coupled calls?
- What errors require different consumer behavior?

Do not expose a database row and call it a contract.

### 3. Define the Smallest Useful Contract

Example:

```yaml
# openapi.yaml
components:
  schemas:
    OrderSummary:
      type: object
      required: [id, status, total]
      properties:
        id:
          type: string
          description: Opaque identifier; never parse as a number.
        status:
          type: string
          enum: [pending, paid, cancelled]
        total:
          type: number
          format: double
          minimum: 0
        cancellationReason:
          type: [string, "null"]
```

Define semantic constraints, not only syntax. For example, document whether
`cancellationReason` is null for every status except `cancelled`.

### 4. Generate or Derive Consumer Types

Prefer generated types over handwritten copies:

```bash
npm run generate:api-types
```

Back that script with the repository's existing, pinned OpenAPI generator.

```typescript
import type { components } from "./generated/api";

type OrderSummary = components["schemas"]["OrderSummary"];

export const paidOrderMock = {
  id: "9007199254740993123",
  status: "paid",
  total: 49.9,
  cancellationReason: null,
} satisfies OrderSummary;
```

The consumer can build against contract-valid mocks while the provider is still
in progress.

### 5. Verify the Provider

The provider must prove that real responses satisfy the same artifact:

```typescript
import type { components } from "./generated/api";

type OrderSummary = components["schemas"]["OrderSummary"];

export function toOrderSummary(row: OrderRow): OrderSummary {
  return {
    // OrderRow.id must arrive from storage as string or bigint, never an
    // already-rounded JavaScript number.
    id: String(row.id),
    status: row.status,
    total: row.total,
    cancellationReason: row.cancellation_reason,
  };
}
```

Static types catch many field and enum mistakes. Add runtime schema validation
or a framework-level contract test at serialization boundaries, where database
values, language coercion, and conditional response paths can still drift.
Converting an unsafe integer to a string after the database driver has rounded
it does not restore the original ID; configure the driver to return string or
bigint first.

Verify every materially different path:

- production and sandbox/mock mode
- success and each documented error
- empty collections
- nullable fields
- feature-flagged or versioned responses

### 6. Integrate by Comparing Evidence

Before merge:

- generate consumer types successfully
- validate consumer fixtures against the contract
- validate provider responses against the contract
- run at least one end-to-end happy path
- confirm no consumer uses undocumented fields

The integration question is not "did both sides pass their own tests?" It is
"did both sides pass against the same boundary artifact?"

## Contract Change Protocol

Never change implementation first and update the contract afterward.

1. Propose the consumer need and compatibility impact.
2. Change the canonical artifact.
3. Review the contract diff with affected consumers and the provider.
4. Regenerate types, clients, or fixtures.
5. Update provider and consumer implementations.
6. Run consumer and provider verification.
7. Merge only when all affected sides agree on the new contract.

For an additive change, verify that old consumers continue to work. For a
breaking change, use the repository's versioning or migration policy rather
than silently repurposing an existing field.

## Anti-Patterns

### FAIL: Provider-Owned Guesswork

```typescript
// Database shape leaks directly to consumers.
return database.query("select * from orders");
```

The storage model now controls the public interface, including accidental
renames and fields the consumer never requested.

### FAIL: Duplicate Sources of Truth

```text
wiki payload example
frontend interface
backend serializer
mock JSON
```

If each copy can change independently, none is authoritative.

### FAIL: Compile-Time Types as the Only Proof

A cast can hide incompatible runtime data:

```typescript
return databaseRow as unknown as OrderSummary;
```

Verify serialized responses, not only local type declarations.

### FAIL: Private Field Changes

Renaming `userName` to `user_name` in one implementation without changing and
reviewing the contract is a breaking change, even if that implementation's
tests remain green.

### FAIL: Contract After Implementation

Generating the contract only after both sides finish records what happened; it
does not coordinate parallel work or prevent drift.

## Best Practices

- Keep one canonical artifact per boundary.
- Design from consumer jobs, then map provider internals at the boundary.
- Make identifiers, nullability, enums, and errors explicit.
- Generate types and mocks where the ecosystem supports it.
- Test real serialized provider output, including alternate paths.
- Treat a contract diff as a cross-team change requiring affected-owner review.
- Prefer a small compatible addition over a speculative general schema.
- Delete handwritten copies once generated or derived versions exist.

## Completion Checklist

- [ ] Consumer and provider owners are known.
- [ ] One authoritative contract artifact is named.
- [ ] Required fields, nullability, enums, and errors are explicit.
- [ ] Consumer types or fixtures come from the contract.
- [ ] Provider responses are verified against the contract.
- [ ] Sandbox, error, and conditional paths are covered where applicable.
- [ ] Breaking changes have a migration or versioning plan.
- [ ] Both sides pass against the same contract before integration.

## Related Skills

- `api-design` - resource, response, error, pagination, and versioning design
- `ai-regression-testing` - regression tests for response-shape and path drift
- `backend-patterns` - provider-side API and service architecture
- `frontend-patterns` - consumer-side data access and UI integration
- `tdd-workflow` - test-first implementation discipline
