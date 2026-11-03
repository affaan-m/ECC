# Rust service lifecycle

Adapted from `bol/domain-cloud-native`.

Model startup, ready, draining, and stopped states explicitly where operational behavior depends on them. Readiness means the instance can serve work; liveness should not trigger restart loops for every transient dependency outage.

On shutdown, stop accepting new work, signal cancellation, drain or abandon work according to a bounded policy, join tasks, and close resources. Account for external orchestrator deadlines. Dropping the runtime without waiting does not demonstrate graceful shutdown.

Use structured tracing with request/job correlation. Avoid recording credentials and unbounded payloads. Metrics should distinguish queued work, active work, dependency latency, application errors, cancellation, and overload.

Define bounds for queues, connections, per-tenant work, retries, and background jobs. A retry loop without a shared deadline can amplify an outage. Cross-instance coordination and durable delivery require explicit persistence/protocol guarantees; an in-process channel alone provides neither.
