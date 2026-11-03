---
name: ecc-node-backend
description: Implement and review Node.js HTTP services, middleware, API contracts, caching, and background jobs.
---

# Node.js backend and APIs

Use the repository's runtime and framework. Validate at trust boundaries, keep
authorization close to resource access, and propagate structured errors without
exposing credentials or internals. Bound request sizes, queues, retries, and
concurrency. Make transaction and idempotency boundaries explicit.

Follow existing API shapes; do not introduce repository layers, response
envelopes, or new frameworks solely because a reference demonstrates them.
Check shutdown, timeout/cancellation, partial-failure, and retry behavior.

For middleware, data access, caching, or workers, read [backend patterns](references/backend.md).
For HTTP semantics, pagination, idempotency, or versioning, read [API design](references/api.md).
