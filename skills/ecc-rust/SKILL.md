---
name: ecc-rust
description: Write, debug, test, and review Rust crates, including ownership, async, traits, error handling, Cargo features, and Rust 2024 compatibility.
---

# Rust development

Start with the crate's `Cargo.toml`, workspace settings, lockfile, toolchain, target, and existing checks. Preserve the current edition, minimum supported Rust version (MSRV), dependency policy, and enabled features. For a new crate, prefer edition `2024` unless its target or dependencies require otherwise; Rust 1.85 is the edition's minimum, not a recommendation to pin every project to 1.85. Do not silently migrate an existing crate.

Resolve compiler errors by tracing ownership and data flow before adding clones, `Arc`, locks, or lifetime bounds. Propagate recoverable errors with `Result` and keep errors actionable at subsystem boundaries. Preserve cancellation, shutdown, and resource ownership when changing async code. Public APIs should express the actual invariants rather than expose mutable internals.

Choose only the references needed for the task. They are design guidance, not a requirement to change working architecture or load all related topics.

| Task or symptom | Reference |
| --- | --- |
| E0382, E0597, returned references, lifetime bounds | [Ownership](references/m01-ownership.md) |
| `Box`, `Rc`, `Arc`, `Weak`, ownership cycles | [Resources](references/m02-resource.md) |
| E0499/E0502, interior mutability, lock scope | [Mutability](references/m03-mutability.md) |
| Trait bounds, generics, dynamic dispatch | [Traits and dispatch](references/m04-zero-cost.md) |
| Newtypes, typestate, builders | [Type-driven design](references/m05-type-driven.md) |
| Error types, `?`, `panic`, library/application boundaries | [Error handling](references/m06-error-handling.md) |
| `Send`/`Sync`, async, task lifetime, deadlocks | [Concurrency](references/m07-concurrency.md) |
| Domain invariants and aggregate ownership | [Domain modeling](references/m09-domain.md) |
| Profiling, allocation, benchmarks | [Performance](references/m10-performance.md) |
| Crate selection, Cargo features, external bindings | [Ecosystem](references/m11-ecosystem.md) |
| `Drop`, cleanup, lazy initialization, shutdown | [Lifecycle](references/m12-lifecycle.md) |
| Recovery, retry, timeout, user-facing errors | [Recovery](references/m13-domain-error.md) |
| Explaining the borrow checker or mental models | [Mental models](references/m14-mental-model.md) |
| Reviewing common Rust mistakes | [Review checklist](references/m15-anti-pattern.md) |
| Tests, doctests, async tests, fuzzing, feature matrices | [Testing](references/testing.md) |
| Edition migration or Rust 2024 changes | [Rust 2024](references/rust-2024.md) |
| CLI configuration, exit status, stdout/stderr | [CLI](references/domain-cli.md) |
| HTTP handlers, extractors, shared service state | [Web](references/domain-web.md) |
| Service shutdown, readiness, bounded queues | [Cloud services](references/domain-cloud-native.md) |
| `no_std`, peripheral ownership, interrupts | [Embedded](references/domain-embedded.md) |

For unsafe/FFI work, use the separately installed `ecc-rust-unsafe` skill when available, or perform an equivalent explicit soundness review. For symbols, callers, dependency graphs, and rename operations, `ecc-rust-navigation` provides a tool-independent workflow.

Run the repository's established checks. Typical Rust gates are `cargo fmt --all -- --check`, targeted `cargo test`, and the project's configured Clippy command. Select packages, targets, and features that match supported builds; `--all-features` is inappropriate when features are mutually exclusive. Do not add dependencies or install tools just to satisfy a generic checklist.
