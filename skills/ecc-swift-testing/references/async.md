# Deterministic async tests

Curated from Swift Testing Pro and Swift Concurrency Pro.

Give the test a way to await completion: an async operation, a retained task
handle, a task group, or an explicit event. `confirmation` records events that
occur during its closure; it does not wait for an event after the closure
returns. Await all work being confirmed inside that closure. A zero expected
count covers only the observed lifetime, not arbitrary future work.

For a finite stream:

```swift
import Testing

@Test
func finiteStreamPreservesOrder() async {
    let (stream, continuation) = AsyncStream.makeStream(of: Int.self)
    continuation.yield(1)
    continuation.yield(2)
    continuation.finish()

    var received: [Int] = []
    await confirmation(expectedCount: 2) { confirm in
        for await value in stream {
            received.append(value)
            confirm()
        }
    }
    #expect(received == [1, 2])
}
```

Use actor isolation that matches the code under test. Main-actor models should
be constructed and inspected on that actor; annotate the relevant test/suite
or use an actual isolation hop. Do not claim isolation for a callback whose
queue/executor contract is unknown.

For cancellation, synchronize the point at which the production operation is
ready, cancel its real task, await termination, and verify cleanup/released
resources. An expectation that a cancelled task eventually exits must exercise
the cancellation path in production, not a new check added only in the test.
Observe underlying API errors such as `URLError.cancelled` as appropriate.

Avoid sleeps and scheduling guesses for coordination. Use a controllable clock
for timer logic or a latch/continuation with an exactly-once terminal protocol.
Test timeouts bound a failure; they do not make a timing assumption deterministic.
Keep teardown responsible for tasks that could otherwise outlive a failing test.

Wrap one-shot legacy callbacks in checked continuations only when completion
and error paths really resume once. Multi-event delegates need a different
observation contract. Do not perform live networking in a unit test just to
make an async example compile. Use isolated protocol doubles or a carefully
scoped URLProtocol transport; shared static handlers can race across tests.
