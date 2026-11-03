# Recovery, retries, and error audiences

Adapted from `bol/m13-domain-error`.

Classify failures by what the caller can do: reject input, retry a transient operation, use a clearly marked degraded result, or stop because an invariant is broken. Whether an error is retryable depends on the operation and its side effects, not only the error type.

Retry only when repetition is safe. A timed-out write may already have committed remotely; use idempotency keys, reconciliation, or a transactional protocol when duplicate effects matter. Bound attempts and total elapsed time; propagate cancellation and use jitter to avoid synchronized retries.

Do not reclassify every transport failure as transient. Authentication errors, malformed requests, and permanent configuration errors generally require intervention. Preserve enough structured context to make the classification inspectable.

Keep external error payloads stable and avoid exposing credentials, SQL, filesystem paths, or private request bodies. Internal logs can contain a source chain and correlation ID with appropriate redaction. A fallback must expose freshness or degraded status when it changes the meaning of success.

For generic async helper bounds, name the future type explicitly:

```rust
use std::future::Future;

pub async fn run_once<F, Fut, T, E>(operation: F) -> Result<T, E>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    operation().await
}
```

Return-position `impl Trait` cannot be inserted into a `Fn` return-type bound as a substitute for the `Fut` parameter. A real retry helper additionally needs the deadline, classification, backoff, and side-effect policy described above.
