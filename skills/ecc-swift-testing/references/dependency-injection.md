# Focused protocols and safe doubles

Adapted from ECC `swift-protocol-di-testing` and Swift Testing Pro. Introduce
seams for I/O and nondeterminism when they make behavior testable; do not mock
private implementation details or force unrelated architecture changes.

Match the protocol's isolation to the production contract. For an asynchronous
sendable boundary, an actor can own a mutable double safely:

```swift
import Foundation
import Testing

protocol BlobSource: Sendable {
    func load() async throws -> Data
}

struct ByteCounter: Sendable {
    let source: any BlobSource

    func count() async throws -> Int {
        let data = try await source.load()
        return data.count
    }
}

enum LoadFailure: Error, Equatable {
    case unavailable
}

actor StubBlobSource: BlobSource {
    private let result: Result<Data, LoadFailure>
    private var calls = 0

    init(result: Result<Data, LoadFailure>) {
        self.result = result
    }

    func load() throws -> Data {
        calls += 1
        return try result.get()
    }

    func callCount() -> Int {
        calls
    }
}

@Test
func byteCountUsesInjectedData() async throws {
    let source = StubBlobSource(result: .success(Data([1, 2, 3])))
    let counter = ByteCounter(source: source)
    let count = try await counter.count()
    let calls = await source.callCount()
    #expect(count == 3)
    #expect(calls == 1)
}

@Test
func byteCountPropagatesLoadFailure() async {
    let source = StubBlobSource(result: .failure(.unavailable))
    let counter = ByteCounter(source: source)
    await #expect(throws: LoadFailure.unavailable) {
        try await counter.count()
    }
}
```

The actor's synchronous isolated implementation can satisfy the asynchronous
protocol requirement; callers across that boundary still await it. A synchronous
protocol cannot be made thread-safe merely by using the same actor witness.
If the real API must be synchronous, use immutable fixtures or appropriate
checked locking rather than redesigning it solely for this sample.

Keep configuration immutable after construction where possible. For mutable
configuration, expose actor-isolated operations rather than public unsynchronized
dictionaries. Inject clocks/randomness and use per-test file locations or
UserDefaults suites. Ensure cleanup runs after failures as well as success.
