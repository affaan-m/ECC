# Unsafe review and validation

Curated from `bol/unsafe-checker/checklists`.

For each changed unsafe operation, state the preconditions and identify the code that establishes them. Check all safe constructors and mutations can preserve the invariant, including early returns, panic, cancellation, reentrancy, and destruction.

Review public unsafe functions for an accurate `# Safety` section. Review safe wrappers for ways a caller could invalidate the underlying storage without invoking unsafe code. Check manual auto traits and variance markers separately from ordinary method correctness.

Boundary cases include zero length, zero-sized types, maximum sizes and arithmetic overflow, partial initialization, duplicate ownership, use after close, and callbacks concurrent with unregistration. Exercise the cases relevant to the abstraction, not an arbitrary list of tools.

Useful verification, when already available and supported:

- Compile and run the project's targeted tests on the relevant target/features.
- Run Miri for supported pure-Rust paths and review its exclusions.
- Use a platform sanitizer for native memory/concurrency paths it can observe.
- Validate FFI behavior with the actual linked library and ownership contract.
- Review release-mode behavior when required checks might be debug-only.

Separate a confirmed defect from a missing proof and from an untested platform assumption. Report limitations honestly; a clean compiler, Miri, or sanitizer run does not establish universal soundness.
