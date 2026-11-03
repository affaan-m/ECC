# Error handling

Adapted from `bol/m06-error-handling` and ECC `rust-patterns`/`rust-testing`.

Use `Option` for expected absence without diagnostic detail and `Result` when callers need to distinguish failure. Preserve the original cause with error sources and add context at a boundary that changes what the operation means.

Libraries generally benefit from structured public errors that callers can match; application boundaries can use an error report type such as `anyhow::Error`. Neither requires a dependency if a small hand-written error type already serves the project.

Use `?` when the caller owns the recovery decision. Match explicitly when retrying, translating protocol errors, cleaning up, or supplying a deliberate fallback. Do not log the same propagated error at every stack frame.

`unwrap`/`expect` are reasonable in tests and for documented invariants. An `expect` message alone does not prove an invariant; failures caused by untrusted input should return errors. Cleanup paths and destructors should avoid introducing a second panic during unwinding.

Avoid collapsing distinct states into defaults (`unwrap_or_default`) when absence, corruption, and a legitimate default require different handling. User-facing errors should be actionable while logs preserve useful context without secrets.

For cancellation and retry classification, read [Recovery](m13-domain-error.md).
