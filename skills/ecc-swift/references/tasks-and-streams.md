# Tasks, cancellation, and callback bridges

Curated from Swift Concurrency Pro and ECC Swift concurrency guidance.

## Structure and ownership

Use `async let` for a fixed set of independent operations, and task groups for
a dynamic set whose lifetime belongs to the caller. Scope exit waits for child
tasks; cancellation is cooperative, so a nonresponsive child can delay return.
Results arrive in completion order, not input order; retain indices when the
caller needs ordered results.

Bound concurrency by seeding a limited number of children and adding one new
child when a result is consumed. Adding every item to a group is not a limit.
For throwing groups, a child's failure is surfaced through result consumption;
cancellation of siblings depends on how that error is handled and whether it
escapes the group scope. Do not assume every child error immediately stops all
other children. Decide whether the contract requires fail-fast or partial results.

`Task {}` inherits actor context where applicable but remains unstructured:
the creating task does not automatically await it or propagate later cancellation.
`Task.detached` also sheds inherited isolation and task-local context. Use either
with an explicit owner, observed result, and stop policy. A synchronous UI action
may need an unstructured task; this is different from hiding async work inside
an API that could expose an async result.

## Cancellation

`await` is not an automatic cancellation check. `cancel()` requests cancellation;
CPU loops and APIs must observe it through their contract, `Task.isCancelled`,
or `Task.checkCancellation()`. Check at points where cleanup and invariants
remain correct. Do not catch cancellation and then retry or display it as an
ordinary user-facing failure. Foundation networking may report cancellation
as `URLError.cancelled`, so match the actual API's error behavior.

`withTaskCancellationHandler` registers synchronous cancellation handling, which
can race with operation setup and completion. Protect shared cancellation-handle
storage and handle cancellation before registration; do not use an unprotected
mutable captured variable. Cancellation must also resolve any checked
continuation left waiting when the underlying API suppresses its callback.

A task-group timeout still waits for children to finish at scope exit. It cannot
impose a hard deadline on an operation that ignores cancellation. Blocking a
cooperative executor with semaphores, synchronous waits, or sleep can starve
the work needed to make progress.

## Continuations and streams

For a one-shot callback, a checked continuation must be resumed exactly once
on every terminal path, including setup failure, cancellation, and completion.
If terminal paths can race, synchronize the ownership of the continuation.
A Boolean checked from multiple threads without synchronization is not a guard.

For repeated callbacks, use an async sequence with a defined subscriber and
buffering contract. `AsyncStream.makeStream` is convenient when supported:

```swift
let (events, continuation) = AsyncStream.makeStream(
    of: Int.self,
    bufferingPolicy: .bufferingNewest(32)
)
```

Observe dropped values when loss matters. A bounded buffer limits retained
memory but does not apply producer backpressure; `yield` does not await the
consumer. Use a different protocol when every event must be delivered.

`AsyncStream.Continuation.finish()` tolerates repeated calls; it is not the
same API as a one-shot checked continuation. Finish when the source completes.
Use `onTermination` to cancel/unregister the source with the synchronization
that source requires. Do not assume a `break` from every arbitrary async
sequence automatically tears down its producer, or that every `for await`
loop implements cancellation in the same way. Define explicit cleanup when
the consumer can stop early while the stream remains retained.

Do not replace Combine or a callback framework solely because a reference uses
async/await. Preserve ordering, replay, multicasting, error, and cancellation
semantics when a migration is actually requested.
