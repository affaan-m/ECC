---
name: ecc-swiftui
description: Build and review SwiftUI views, Observation state, navigation, adaptive macOS and iOS layouts, accessibility, localization, and rendering performance.
---

# SwiftUI development

Adapted from ECC `swiftui-patterns` and Paul Hudson's SwiftUI Pro. Implement
the requested behavior and report concrete findings; do not turn a feature or
bug fix into an unrelated modernization or architecture migration.

Read the project's Swift/Xcode versions, SDK, deployment targets, supported
platforms, and concurrency settings. New SDK declarations need a compiler that
recognizes them; runtime APIs may also need an availability guard. Preserve
existing targets. An iOS-specific recommendation may not apply to macOS.

Make state ownership and identity explicit. Keep UI-facing mutable state on
the appropriate actor. Observation tracks access; it does not by itself make
an arbitrary model thread-safe. Retain existing ObservableObject/Combine designs
where compatibility or scope requires them.

Read only the references matching the work:

- For `@State`, `@Binding`, `@Bindable`, Observation, environment values,
  asynchronous loading, or model identity, read [state and lifecycle](references/state.md).
- For navigation, sheets, window resizing, split views, or API availability,
  read [navigation and adaptive layout](references/navigation-layout.md).
- For accessible controls, keyboard/focus behavior, Dynamic Type, VoiceOver,
  or localized text, read [accessibility and localization](references/accessibility-localization.md).
- For excessive updates, scrolling, expensive bodies, or rendering bottlenecks,
  read [performance](references/performance.md).

Use the existing design system and supported native controls. UIKit/AppKit
interop is appropriate when required by a real framework or behavior boundary;
do not add a dependency or custom control just to match a reference's style.

Validate relevant platform builds and real behavior: loading/error/empty states,
navigation/back behavior, resizing, keyboard access, and accessibility settings
where affected. Previews help inspect variants but do not replace app tests.
Use available tooling and state precisely which UI checks actually ran.
