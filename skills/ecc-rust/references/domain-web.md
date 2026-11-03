# Rust web service constraints

Adapted from `bol/domain-web`.

Follow the pinned framework version and existing middleware composition. Typed extractors parse a representation; they do not automatically prove authorization or domain validity. Apply authentication, authorization, and resource limits at the correct boundary.

Keep shared application state distinct from per-request state. `Arc` shares ownership, and a database pool may already be cheap to clone. Avoid putting a whole application behind one mutex. Match `Send`/`Sync` requirements to the framework's actual executor and handler bounds.

Bound request bodies, concurrency, upstream waits, and database acquisition. Do not block executor threads with CPU-heavy parsing or synchronous I/O. A client disconnect may cancel a handler while spawned work continues; define whether such work is safe to abandon, complete, or reconcile.

Translate internal errors into stable HTTP/protocol responses while recording a redacted source chain and request ID. Preserve error status distinctions, pagination contracts, streaming backpressure, and retry/idempotency behavior.

Test handlers at the service boundary for accepted/rejected input, authentication, authorization, body limits, timeouts, and unexpected upstream failures. Use the actual routing/middleware path rather than only testing an inner function.
