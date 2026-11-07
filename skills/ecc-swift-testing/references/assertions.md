# Assertions, suites, and migration

Curated from Swift Testing Pro. Match trait and macro APIs to the installed
toolchain and preserve existing test framework choices.

Prefer value-type suites when no reference lifecycle is needed. A type with
`@Test` methods is already a suite; `@Suite` is useful for suite-level traits
or display configuration. Initialize fixtures per test through supported
initializers or explicit setup helpers. `@MainActor` establishes isolation;
it does not make an entire async test atomic across suspension points.

Use `#expect` for independent behavior assertions and `try #require` for a
precondition or optional needed by the rest of the test. Assert specific error
cases, not just that any error occurred. For asynchronous expressions, await
the result before inspecting it when that makes isolation and diagnostics clearer.

```swift
import Testing

enum InputError: Error, Equatable {
    case empty
}

func parseIdentifier(_ input: String) throws -> String {
    guard input.isEmpty == false else { throw InputError.empty }
    return input
}

@Test(arguments: ["alpha", "beta"])
func identifiersRoundTrip(_ input: String) throws {
    #expect(try parseIdentifier(input) == input)
}

@Test
func emptyIdentifierIsRejected() {
    #expect(throws: InputError.empty) {
        try parseIdentifier("")
    }
}
```

Two argument collections form a Cartesian product. For pairwise cases, use
one collection of tuples or an appropriately supported zipped sequence.
Use tags/bug references when they help the existing suite; no tag is mandatory.

`.serialized` orders tests within its supported suite/argument scope. It does
not serialize unrelated suites or make global mutable fixtures safe. Prefer
isolating the shared dependency first. Time limits are failure bounds, not a
substitute for awaiting completion; use the units supported by `TimeLimitTrait`
in the installed framework rather than guessing an API from `Duration`.

For requested XCTest migration:

| XCTest | Swift Testing |
| --- | --- |
| `XCTAssertEqual(a, b)` | `#expect(a == b)` |
| `XCTUnwrap(value)` | `try #require(value)` |
| `XCTFail(message)` | `Issue.record(message)` |
| Throw assertions | `#expect(throws:)` with the expected case/type |

Preserve coverage and behavior first. Keep XCUITest and any XCTest features
the project still needs. For floating-point checks, choose a tolerance matching
the numerical contract and handle non-finite values where relevant. A simple
absolute tolerance can use `abs(actual - expected) <= tolerance`; no new
dependency is universally required. Preserve an established relative-tolerance
or approximate-equality helper if the project already has one.

Newer attachments, test-scoping traits, exit tests, and returned-error macros
require framework/version checks. Use exit tests only when the runner supports
their subprocess behavior; they are not ordinary in-process assertions.
