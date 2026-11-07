---
name: ecc-swift
description: Implement and review Swift modules, actor isolation, structured concurrency, cancellation, Sendable boundaries, and file persistence.
---

# Swift development and concurrency

Adapted from ECC's Swift concurrency/persistence skills and Paul Hudson's
Swift Concurrency Pro. Preserve the project's architecture and supported platforms.

Inspect `Package.swift`, Xcode project settings, CI, `swift --version`, SDK,
deployment targets, and language mode before choosing APIs. Check concurrency
settings per module, including default actor isolation, strict checking, and
`NonisolatedNonsendingByDefault`. Swift 6.2 support alone does not enable every
Approachable Concurrency setting. Do not silently raise a deployment target,
change language mode, or enable new compiler features.

Follow ownership across tasks, actors, callbacks, and resource lifetimes.
`async` does not imply background execution. An actor prevents unsynchronized
access to its isolated state, but an `await` can permit other work to change that
state before execution resumes. Avoid adding actors or `@MainActor` solely to
silence diagnostics; choose the isolation required by the actual API.

Read only the matching reference:

- For isolation diagnostics, Swift 6.2 settings, `Sendable`, isolated conformances,
  or CPU offloading, read [isolation](references/isolation.md).
- For task groups, task ownership, cancellation, continuations, streams, or
  callback/Combine/GCD interoperability, read [tasks and streams](references/tasks-and-streams.md).
- For an actor-backed cache, file writes, durability, or corrupt storage,
  read [persistence](references/persistence.md).

Prefer structured concurrency when work belongs to the caller. Retain handles
for deliberately unstructured work, observe failures, and define shutdown and
cancellation. Keep `@unchecked Sendable` limited to a documented synchronization
proof; it does not supply synchronization. Retain synchronous locks, dispatch
queues, and framework interop where they fit the required contract.

Use the existing SwiftPM/Xcode checks and exact supported target, scheme, and
configuration. For SwiftPM projects, typical checks are `swift build` and
`swift test`. Discover real Xcode schemes before running `xcodebuild`; do not
invent a project name or simulator. A SwiftPM build does not validate an app's
UI, signing, entitlements, or unsupported deployment targets.

For SwiftUI rendering/state/navigation work, use `ecc-swiftui` when available.
For test design and concurrency-safe doubles, use `ecc-swift-testing` when available.
