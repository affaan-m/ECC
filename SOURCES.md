# Sources and curation

- ECC upstream snapshot: Git commit `b38be6a7` (the original checkout in this
  directory). The upstream MIT license is retained in [LICENSE](LICENSE).
- Go, TypeScript, Vue/Nuxt, React, backend/API, Playwright, accessibility,
  application security, PostgreSQL/migrations, Docker, and optimization
  references are adapted from the corresponding upstream `skills/` directories.
  Entry instructions, discovery names, routing, and installation were revised
  for this curated Codex collection. This is not the full upstream ECC plugin.
- Rust material was supplied by the user in the sibling `bol/` directory.
  Its technical topics were consolidated and reviewed for Rust 2024 and Codex.
  No separate license was supplied with `bol`; the upstream ECC MIT file does
  not establish redistribution rights for the user's separate Rust material.
- React performance attribution to Vercel Labs and PostgreSQL attribution to
  Supabase remain in their reference files.
- Zig guidance and the installer/validator were added in this curation.

## Swift and SwiftUI sources

The `swift` profile adapts the original ECC skills `swift-concurrency-6-2`,
`swift-actor-persistence`, `swift-protocol-di-testing`, and `swiftui-patterns`
from commit `b38be6a7`. It also incorporates selected guidance from Paul Hudson's
MIT-licensed skills, inspected on 2026-11-07:

| Source | Pinned commit | Local skill and retained license |
| --- | --- | --- |
| [SwiftUI Agent Skill / SwiftUI Pro](https://github.com/twostraws/SwiftUI-Agent-Skill) | `f2920b63995263f57b3e198674e89a602efba6d2` | [ecc-swiftui](skills/ecc-swiftui/SKILL.md), [MIT license](skills/ecc-swiftui/LICENSE) |
| [Swift Concurrency Agent Skill](https://github.com/twostraws/Swift-Concurrency-Agent-Skill) | `bee3f69ba17142da148d3c5406f148ed62592b69` | [ecc-swift](skills/ecc-swift/SKILL.md), [MIT license](skills/ecc-swift/LICENSE) |
| [Swift Testing Agent Skill](https://github.com/twostraws/Swift-Testing-Agent-Skill) | `2d6bba14a3c8bf3694f218b92fffe617c41ae43e` | [ecc-swift-testing](skills/ecc-swift-testing/SKILL.md), [MIT license](skills/ecc-swift-testing/LICENSE) |

[Swift-Agent-Skills](https://github.com/twostraws/Swift-Agent-Skills) is the
discovery directory used to find the concurrency and testing repositories;
it is not imported as another installed skill collection. Other directory
entries, such as SwiftData and App Store tools, are not bundled here.

The local references are condensed adaptations, not unmodified upstream
entrypoints. Scope is selected by task; there is no mandatory load-all review,
automatic SDK/language-mode upgrade, dependency installation, or assumed
deployment target. The persistence example commits its cache after a successful
write, the mutable test double is actor-isolated, and concurrency guidance
distinguishes optional module settings, reentrancy, cancellation, and stream
termination. Existing XCTest, ObservableObject, AppKit/UIKit, and synchronous
interop remain valid where the target project requires them.

Validation for this addition used Apple Swift 6.4: extracted non-UI examples
compiled with Swift 6 strict concurrency and warnings as errors, and also
typechecked with MainActor default isolation plus
`NonisolatedNonsendingByDefault`. Fourteen direct runtime scenarios checked
persistence, failed commits, concurrent writes, cancellation, overflow, injected
data/errors, finite stream ordering, and identifier handling. The SwiftUI sample
and macro-based Swift Testing suite could not be fully validated because the
installed Command Line Tools lacked `SwiftUIMacros` and `TestingMacros` plugins.
No UI-runner or macro-test success is claimed.

Primary documentation checked during adaptation:

- [Codex skill discovery and authoring](https://learn.chatgpt.com/docs/build-skills)
- [Rust 2024 edition guide](https://doc.rust-lang.org/edition-guide/rust-2024/index.html)
- [Zig language documentation](https://ziglang.org/documentation/)
- [Swift 6.2 language and concurrency changes](https://www.swift.org/blog/swift-6.2-released/)

Documentation examples are conditional reference material. Match them to the
target project's dependency versions and actual toolchain. No claim is made
that every example across all references was built or executed.

The installer and packaging have local automated checks. These do not constitute
a Snyk service scan or end-to-end evaluation of model skill selection.
