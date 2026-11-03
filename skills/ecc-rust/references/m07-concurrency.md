# Concurrency and async

Adapted from `bol/m07-concurrency`, including its async and thread patterns.

Separate task concurrency from CPU parallelism. Async runs cooperatively; blocking syscalls, long CPU loops, and `std::thread::sleep` block the executor thread. Use the project's bounded blocking/CPU pool when needed, and account for its shutdown behavior.

`Send` permits transferring ownership across threads; `Sync` permits sharing references across threads. Bounds depend on all relevant fields and captures. A non-`Send` value held across a suspension point can make the future non-`Send`; narrow its lexical scope or use the existing local executor when thread affinity is intentional.

`Arc<T>` is not a replacement for synchronization. Prefer a single owner plus messages when an operation changes several fields atomically. Bound channels and in-flight work; boundless queues convert overload into memory growth.

For locks:

- A short synchronous critical section may use a synchronous mutex inside async code if contention cannot stall the runtime unacceptably.
- Use an async lock when waiting should yield or the invariant truly spans async work; avoid holding any guard across unrelated `.await` calls.
- `RwLock` and atomics require measurement and a correct protocol; they are not universal improvements over `Mutex`.

For task lifetime:

- Decide who owns spawned tasks, observes failures, and waits for shutdown.
- Dropping a join handle may detach a task; dropping a future may cancel it. Check the runtime's semantics.
- Cancellation during a multi-step mutation must not leave partial state or silently lose a message.
- Propagate deadlines through layers rather than restarting a fresh timeout at each hop.

For implementation details, read [Async lifecycle patterns](patterns/async-lifecycle.md).
