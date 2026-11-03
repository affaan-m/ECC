# Async lifecycle patterns

Adapted from `bol/m07-concurrency/patterns` and thread examples.

Treat spawn as an ownership boundary. Owned captures must contain everything required for the task's lifetime. Scoped threads can borrow local data because the scope joins them before that data disappears; ordinary detached tasks need a different lifetime story.

Keep tasks observable with the runtime's join/task-set abstraction. Distinguish task failure from an inner `Result::Err`; both layers matter. A shutdown signal is a request, so join tasks or otherwise verify completion before freeing resources they use.

`select!` drops losing branch futures. Check cancellation safety for each selected operation: partially consuming a message, incrementally writing a frame, or acquiring several resources can change state before suspension. Avoid a loop that restarts a non-cancellation-safe operation and silently discards its progress.

Timeouts cancel the awaited future when it is dropped; they do not necessarily stop already spawned or blocking work. A CPU-bound blocking task may need its own cooperative cancellation check. Bound the amount of detached work during repeated timeouts.

For a queue, define capacity, enqueue deadline, overload behavior, ordering, and shutdown drainage. A semaphore permit must cover the actual work lifetime; releasing it immediately after spawning defeats the concurrency limit.

Drop lock guards in a lexical scope before unrelated awaits. An async mutex permits yielding while held but can still serialize the whole service, deadlock through reentrancy, or retain inconsistent state when the task is cancelled.
