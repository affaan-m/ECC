---
name: ecc-swift-testing
description: Write and review Swift tests, Swift Testing assertions, async lifecycle checks, protocol injection, and concurrency-safe test doubles.
---

# Swift testing and dependency boundaries

Adapted from ECC `swift-protocol-di-testing` and Paul Hudson's Swift Testing Pro.
Inspect the installed Swift Testing version, test target isolation, existing
XCTest suites, and CI before choosing APIs. Follow the project's framework;
do not migrate existing tests merely to modernize them. XCTest remains the
tool for XCUITest UI automation; Swift Testing does not replace that runner.

Test observable behavior, error paths, and resource/task lifetimes. Keep each
test isolated from shared files, defaults, real accounts, clocks, and network
services unless an integration test explicitly requires them. Swift Testing
runs tests concurrently by default, so fixtures and doubles need a real
isolation/transfer story, not `@unchecked Sendable` on mutable dictionaries.

- For assertions, parameterization, test traits, or XCTest migration, read
  [assertions and suites](references/assertions.md).
- For confirmations, cancellation, actor-isolated code, or asynchronous events,
  read [async tests](references/async.md).
- For focused protocols and safe injectable mocks, read
  [dependency injection](references/dependency-injection.md).

Preserve working architecture. Add a test seam at an external boundary when
it enables meaningful testing; do not wrap every concrete type in a protocol.
Await the actual operation or a deterministic synchronization event, not an
arbitrary delay. A passing confirmation before background work completes is
not evidence that the behavior was tested.

Run relevant `swift test` filters or the project's Xcode test scheme. Report
the targets and configurations actually checked. Compiler-only validation of
a sample does not prove runtime behavior or UI accessibility.
