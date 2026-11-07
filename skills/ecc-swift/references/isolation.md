# Actor isolation and Swift 6 settings

Curated from ECC `swift-concurrency-6-2` and Swift Concurrency Pro. Examples
depend on the project's compiler, language mode, and module settings.

## Diagnose the boundary

Identify which actor owns each value, who can retain or mutate it, and which
call transfers it. Read diagnostics at the transfer site rather than repeatedly
adding `Sendable`, `nonisolated`, or `Task.detached` until the error disappears.

| Symptom | Inspect before changing annotations |
| --- | --- |
| Sending a value risks a race | Remaining aliases, closure captures, transfer ownership, and receiver isolation |
| Non-sendable capture in a sendable closure | Actual closure executor, value semantics, and safe transfer/copy strategy |
| Global/static state is not concurrency-safe | Intended owner and whether state can be immutable or isolated |
| Actor-isolated protocol conformance mismatch | Requirement's callers and supported isolated-conformance features |
| Async call lacks `await` | Actor hop and caller contract; do not wrap it in an unobserved task |

`Sendable` describes safe cross-domain use. Value types are not automatically
sendable if their stored members are not. `sending` can express one-way region
transfer when the compiler supports it; the sender must respect the transfer.
Use checked conformances when possible. A mutable class is not made safe by
adding `@unchecked Sendable`.

## Settings are independent

- Swift compiler version and Swift language mode are separate choices.
- Default `MainActor` isolation is a per-module setting. A package and an app
  using it can have different defaults.
- With `NonisolatedNonsendingByDefault` enabled, plain nonisolated async work
  can remain on the caller's actor. Without it, older executor semantics may
  apply. Inspect the setting instead of inferring it from the Swift 6.2 label.
- Suspending network I/O does not block an actor while waiting. Synchronous
  parsing or image processing before/after suspension can still occupy it.
- `@concurrent`, where supported, explicitly moves an async function to the
  generic executor. Use it for a measured need to leave the caller's actor;
  it does not remove transfer requirements or imply one dedicated thread.
- An isolated conformance restricts where that conformance may be used. It
  cannot satisfy a requirement that genuinely needs unrestricted access.

For example, on a compiler supporting `@concurrent`:

```swift
@concurrent
func sumMeasurements(_ measurements: [Int]) async throws -> Int {
    var total = 0
    for measurement in measurements {
        try Task.checkCancellation()
        let addition = total.addingReportingOverflow(measurement)
        guard addition.overflow == false else { throw SumError.overflow }
        total = addition.partialValue
    }
    return total
}

enum SumError: Error {
    case overflow
}
```

This example keeps overflow and cooperative cancellation explicit. A fast,
small sum would not justify an executor hop by itself.

## Reentrancy and lifecycle

An actor's synchronous isolated region is serialized; an entire async method
is not a transaction. After `await`, revalidate assumptions before updating
shared state. For a cache miss, decide whether duplicate downloads are allowed
or whether an in-flight task per key is required. Returning a local result
avoids rereading invalidated state but does not deduplicate requests.

Task closures can retain their owner until they complete. A `deinit` that
cancels a task is insufficient if that task prevents deinitialization. Prefer
an explicit stop/lifecycle owner where necessary. For thread-affine resources,
verify destruction isolation as well as creation and ordinary access.

Runtime actor assertions diagnose violated assumptions; they do not arrange
execution on the actor. `MainActor.assumeIsolated` requires an existing executor
guarantee. Newer features such as isolated deinitializers, task naming, or
immediate task start need compiler/runtime availability checks before use.

Primary reference: [Swift 6.2 concurrency changes](https://www.swift.org/blog/swift-6.2-released/).
