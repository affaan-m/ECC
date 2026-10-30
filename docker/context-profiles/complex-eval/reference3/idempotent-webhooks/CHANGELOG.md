# Changelog

- 2026-09-25: Fixed INC-104 — the receiver now claims each event id and applies
  the payment synchronously in one event-loop turn, so concurrent duplicate
  deliveries can never both pass the seen-check. Added idempotency regression
  tests for concurrent duplicates, retries, and already-paid orders.
