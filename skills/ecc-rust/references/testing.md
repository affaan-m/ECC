# Testing Rust changes

Adapted from ECC `rust-testing` and `bol` ownership/concurrency examples.

Use existing project commands and select tests for changed behavior. Unit tests fit pure parsing and local invariants; integration tests fit protocol boundaries and subsystem interactions; doctests verify public API examples. Avoid tests that merely repeat the implementation or assert its private structure.

Common commands, adjusted for the workspace's actual packages, features, and target:

```bash
cargo fmt --all -- --check
cargo test -p package_name
cargo test -p package_name --doc
cargo clippy -p package_name --all-targets -- -D warnings
```

`package_name` denotes the real package selected for the task, not a command to run verbatim. Respect existing Clippy warnings and exceptions rather than adding `-D warnings` to a project that has not adopted it.

Test failure paths and boundaries: empty/truncated input, integer limits, cancellation between mutations, channel closure, task panic, deadlines, and shutdown with in-flight work. Use deterministic synchronization or the runtime's controlled clock where available rather than timing assumptions and arbitrary sleeps.

For async tests, match the runtime flavor used in production. A current-thread test will not expose every cross-thread `Send` constraint; a multithreaded test will not model thread-affine GUI code. Exercise both only when both are supported behaviors.

Property testing and fuzzing are useful for parsers and invariants with large input spaces. Keep regression seeds for real failures. Miri can test supported unsafe code paths but does not prove soundness and cannot execute arbitrary foreign libraries or every platform operation.

Coverage is diagnostic evidence, not a universal percentage gate. Retain the project's required coverage policy if one exists. Run a supported feature/target matrix for cfg-sensitive changes rather than treating `--all-features` as a complete matrix.
