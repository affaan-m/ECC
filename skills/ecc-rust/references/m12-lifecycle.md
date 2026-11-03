# Resource lifecycle

Adapted from `bol/m12-lifecycle`.

Give each file, socket, task, transaction, and foreign pointer one clear ownership story. RAII covers ordinary scope exit and unwinding; it does not guarantee cleanup after process abort, leaks, or forced termination.

`Drop` cannot perform general async cleanup. Provide an explicit shutdown/close path when errors or asynchronous completion matter, with `Drop` as an appropriate fallback. A destructor should not silently claim durable flush or protocol close succeeded.

Pools require bounds, acquisition deadlines, broken-resource handling, and a shutdown policy. A checked-out resource must return to the correct pool or be discarded when its protocol state is uncertain.

Use `OnceLock`/`LazyLock` when their availability fits the MSRV and the initialization semantics fit the application. `once_cell`, `std::sync::Mutex`, and `std::sync::mpsc` are not deprecated merely because alternatives exist. Initialization failure, reentrancy, and tests needing isolated state can favor explicit ownership instead of a global.

For transactions and temporary state, commit only after all required work succeeds. Ensure cancellation or an early return rolls back or leaves a recoverable state. Cleanup should not reacquire locks in an order that conflicts with ordinary operations.
