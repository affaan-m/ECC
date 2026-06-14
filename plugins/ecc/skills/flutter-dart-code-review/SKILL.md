---
name: flutter-dart-code-review
description: Library-agnostic Flutter/Dart code review checklist covering widget best practices, state management patterns (BLoC, Riverpod, Provider, GetX, MobX, Signals), Dart idioms, performance, accessibility, security, and clean architecture.
---

# Flutter/Dart Code Review Best Practices

Comprehensive, library-agnostic checklist for reviewing Flutter/Dart applications. These principles apply regardless of which state management solution, routing library, or DI framework is used.

---

## 1. General Project Health

- [ ] Project follows consistent folder structure (feature-first or layer-first)
- [ ] Proper separation of concerns: UI, business logic, data layers
- [ ] No business logic in widgets; widgets are purely presentational
- [ ] `pubspec.yaml` is clean — no unused dependencies, versions pinned appropriately
- [ ] `analysis_options.yaml` includes a strict lint set with strict analyzer settings enabled
- [ ] No `print()` statements in production code — use `dart:developer` `log()` or a logging package
- [ ] Generated files (`.g.dart`, `.freezed.dart`, `.gr.dart`) are up-to-date or in `.gitignore`
- [ ] Platform-specific code isolated behind abstractions

---

## 2. Dart Language Pitfalls

- [ ] **Implicit dynamic**: Missing type annotations leading to `dynamic` — enable `strict-casts`, `strict-inference`, `strict-raw-types`
- [ ] **Null safety misuse**: Excessive `!` (bang operator) instead of proper null checks or Dart 3 pattern matching (`if (value case var v?)`)
- [ ] **Type promotion failures**: Using `this.field` where local variable promotion would work
- [ ] **Catching too broadly**: `catch (e)` without `on` clause; always specify exception types
- [ ] **Catching `Error`**: `Error` subtypes indicate bugs and should not be caught
- [ ] **Unused `async`**: Functions marked `async` that never `await` — unnecessary overhead
- [ ] **`late` overuse**: `late` used where nullable or constructor initialization would be safer; defers errors to runtime
- [ ] **String concatenation in loops**: Use `StringBuffer` instead of `+` for iterative string building
- [ ] **Mutable state in `const` contexts**: Fields in `const` constructor classes should not be mutable
- [ ] **Ignoring `Future` return values**: Use `await` or explicitly call `unawaited()` to signal intent
- [ ] **`var` where `final` works**: Prefer `final` for locals and `const` for compile-time constants
- [ ] **Relative imports**: Use `package:` imports for consistency
- [ ] **Mutable collections exposed**: Public APIs should return unmodifiable views, not raw `List`/`Map`
- [ ] **Missing Dart 3 pattern matching**: Prefer switch expressions and `if-case` over verbose `is` checks and manual casting
- [ ] **Throwaway classes for multiple returns**: Use Dart 3 records `(String, int)` instead of single-use DTOs
- [ ] **`print()` in production code**: Use `dart:developer` `log()` or the project's logging package; `print()` has no log levels and cannot be filtered

---

## 3. Widget Best Practices

### Widget decomposition:
- [ ] No single widget with a `build()` method exceeding ~80-100 lines
- [ ] Widgets split by encapsulation AND by how they change (rebuild boundaries)
- [ ] Private `_build*()` helper methods that return widgets are extracted to separate widget classes (enables element reuse, const propagation, and framework optimizations)
- [ ] Stateless widgets preferred over Stateful where no mutable local state is needed
- [ ] Extracted widgets are in separate files when reusable

### Const usage:
- [ ] `const` constructors used wherever possible — prevents unnecessary rebuilds
- [ ] `const` literals for collections that don't change (`const []`, `const {}`)
- [ ] Constructor is declared `const` when all fields are final

### Key usage:
- [ ] `ValueKey` used in lists/grids to preserve state across reorders
- [ ] `GlobalKey` used sparingly — only when accessing state across the tree is truly needed
- [ ] `UniqueKey` avoided in `build()` — it forces rebuild every frame
- [ ] `ObjectKey` used when identity is based on a data object rather than a single value

### Theming & design system:
- [ ] Colors come from `Theme.of(context).colorScheme` — no hardcoded `Colors.red` or hex values
- [ ] Text styles come from `Theme.of(context).textTheme` — no inline `TextStyle` with raw font sizes
- [ ] Dark mode compatibility verified — no assumptions about light background
- [ ] Spacing and sizing use consistent design tokens or constants, not magic numbers

### Build method complexity:
- [ ] No network calls, file I/O, or heavy computation in `build()`
- [ ] No `Future.then()` or `async` work in `build()`
- [ ] No subscription creation (`.listen()`) in `build()`
- [ ] `setState()` localized to smallest possible subtree

---

## 4. State Management (Library-Agnostic)

These principles apply to all Flutter state management solutions (BLoC, Riverpod, Provider, GetX, MobX, Signals, ValueNotifier, etc.).

### Architecture:
- [ ] Business logic lives outside the widget layer — in a state management component (BLoC, Notifier, Controller, Store, ViewModel, etc.)
- [ ] State managers receive dependencies via injection, not by constructing them internally
- [ ] A service or repository layer abstracts data sources — widgets and state managers should not call APIs or databases directly
- [ ] State managers have a single responsibility — no "god" managers handling unrelated concerns
- [ ] Cross-component dependencies follow the solution's conventions:
  - In **Riverpod**: providers depending on providers via `ref.watch` is expected — flag only circular or overly tangled chains
  - In **BLoC**: blocs should not directly depend on other blocs — prefer shared repositories or presentation-layer coordination
  - In other solutions: follow the documented conventions for inter-component communication

### Immutability & value equality (for immutable-state solutions: BLoC, Riverpod, Redux):
- [ ] State objects are immutable — new instances created via `copyWith()` or constructors, never mutated in-place
- [ ] State classes implement `==` and `hashCode` properly (all fields included in comparison)
- [ ] Mechanism is consistent across the project — manual override, `Equatable`, `freezed`, Dart records, or other
- [ ] Collections inside state objects are not exposed as raw mutable `List`/`Map`

### Reactivity discipline (for reactive-mutation solutions: MobX, GetX, Signals):
- [ ] State is only mutated through the solution's reactive API (`@action` in MobX, `.value` on signals, `.obs` in GetX) — direct field mutation bypasses change tracking
- [ ] Derived values use the solution's computed mechanism rather than being stored redundantly
- [ ] Reactions and disposers are properly cleaned up (`ReactionDisposer` in MobX, effect cleanup in Signals)

### State shape design:
- [ ] Mutually exclusive states use sealed types, union variants, or the solution's built-in async state type (e.g. Riverpod's `AsyncValue`) — not boolean flags (`isLoading`, `isError`, `hasData`)
- [ ] Every async operation models loading, success, and error as distinct states
- [ ] All state variants are handled exhaustively in UI — no silently ignored cases
- [ ] Error states carry error information for display; loading states don't carry stale data
- [ ] Nullable data is not used as a loading indicator — states are explicit

```dart
// BAD — boolean flag soup allows impossible states
class UserState {
  bool isLoading = false;
  bool hasError = false; // isLoading && hasError is representable!
  User? user;
}

// GOOD (immutable approach) — sealed types make impossible states unrepresentable
sealed class UserState {}
class UserInitial extends UserState {}
class UserLoading extends UserState {}
class UserLoaded extends UserState {
  final User user;
  const UserLoaded(this.user);
}
class UserError extends UserState {
  final String message;
  const UserError(this.message);
}

// GOOD (reactive approach) — observable enum + data, mutations via reactivity API
// enum UserStatus { initial, loading, loaded, error }
// Use your solution's observable/signal to wrap status and data separately
```

### Rebuild optimization:
- [ ] State consumer widgets (Builder, Consumer, Observer, Obx, Watch, etc.) scoped as narrow as possible
- [ ] Selectors used to rebuild only when specific fields change — not on every state emission
- [ ] `const` widgets used to stop rebuild propagation through the tree
- [ ] Computed/derived state is calculated reactively, not stored redundantly

### Subscriptions & disposal:
- [ ] All manual subscriptions (`.listen()`) are cancelled in `dispose()` / `close()`
- [ ] Stream controllers are closed when no longer needed
- [ ] Timers are cancelled in disposal lifecycle
- [ ] Framework-managed lifecycle is preferred over manual subscription (declarative builders over `.listen()`)
- [ ] `mounted` check before `setState` in async callbacks
- [ ] `BuildContext` not used after `await` without checking `context.mounted` (Flutter 3.7+) — stale context causes crashes
- [ ] No navigation, dialogs, or scaffold messages after async gaps without verifying the widget is still mounted
- [ ] `BuildContext` never stored in singletons, state managers, or static fields

### Local vs global state:
- [ ] Ephemeral UI state (checkbox, slider, animation) uses local state (`setState`, `ValueNotifier`)
- [ ] Shared state is lifted only as high as needed — not over-globalized
- [ ] Feature-scoped state is properly disposed when the feature is no longer active

---

## 5. Performance

### Unnecessary rebuilds:
- [ ] `setState()` not called at root widget level — localize state changes
- [ ] `const` widgets used to stop rebuild propagation
- [ ] `RepaintBoundary` used around complex subtrees that repaint independently
- [ ] `AnimatedBuilder` child parameter used for subtrees independent of animation

### Expensive operations in build():
- [ ] No sorting, filtering, or mapping large collections in `build()` — compute in state management layer
- [ ] No regex compilation in `build()`
- [ ] `MediaQuery.of(context)` usage is specific (e.g., `MediaQuery.sizeOf(context)`)

### Image optimization:
- [ ] Network images use caching (any caching solution appropriate for the project)
- [ ] Appropriate image resolution for target device (no loading 4K images for thumbnails)
- [ ] `Image.asset` with `cacheWidth`/`cacheHeight` to decode at display size
- [ ] Placeholder and error widgets provided for network images

### Lazy loading:
- [ ] `ListView.builder` / `GridView.builder` used instead of `ListView(children: [...])` for large or dynamic lists (concrete constructors are fine for small, static lists)
- [ ] Pagination implemented for large data sets
- [ ] Deferred loading (`deferred as`) used for heavy libraries in web builds

### Other:
- [ ] `Opacity` widget avoided in animations — use `AnimatedOpacity` or `FadeTransition`
- [ ] Clipping avoided in animations — pre-clip images
- [ ] `operator ==` not overridden on widgets — use `const` constructors instead
- [ ] Intrinsic dimension widgets (`IntrinsicHeight`, `IntrinsicWidth`) used sparingly (extra layout pass)

---

## 6. Testing

### Test types and expectations:
- [ ] **Unit tests**: Cover all business logic (state managers, repositories, utility functions)
- [ ] **Widget tests**: Cover individual widget behavior, interactions, and visual output
- [ ] **Integration tests**: Cover critical user flows end-to-end
- [ ] **Golden tests**: Pixel-perfect comparisons for design-critical UI components

### Coverage targets:
- [ ] Aim for 80%+ line coverage on business logic
- [ ] All state transitions have corresponding tests (loading → success, loading → error, retry, etc.)
- [ ] Edge cases tested: empty states, error states, loading states, boundary values

### Test isolation:
- [ ] External dependencies (API clients, databases, services) are mocked or faked
- [ ] Each test file tests exactly one class/unit
- [ ] Tests verify behavior, not implementation details
- [ ] Stubs define only the behavior needed for each test (minimal stubbing)
- [ ] No shared mutable state between test cases

### Widget test quality:
- [ ] `pumpWidget` and `pump` used correctly for async operations
- [ ] `find.byType`, `find.text`, `find.byKey` used appropriately
- [ ] No flaky tests depending on timing — use `pumpAndSettle` or explicit `pump(Duration)`
- [ ] Tests run in CI and failures block merges

---

## 7. Accessibility

### Semantic widgets:
- [ ] `Semantics` widget used to provide screen reader labels where automatic labels are insufficient
- [ ] `ExcludeSemantics` used for purely decorative elements
- [ ] `MergeSemantics` used to combine related widgets into a single accessible element
- [ ] Images have `semanticLabel` property set

### Screen reader support:
- [ ] All interactive elements are focusable and have meaningful descriptions
- [ ] Focus order is logical (follows visual reading order)

### Visual accessibility:
- [ ] Contrast ratio >= 4.5:1 for text against background
- [ ] Tappable targets are at least 48x48 pixels
- [ ] Color is not the sole indicator of state (use icons/text alongside)
- [ ] Text scales with system font size settings

### Interaction accessibility:
- [ ] No no-op `onPressed` callbacks — every button does something or is disabled
- [ ] Error fields suggest corrections
- [ ] Context does not change unexpectedly while user is inputting data

---

## 8. Platform-Specific Concerns

### iOS/Android differences:
- [ ] Platform-adaptive widgets used where appropriate
- [ ] Back navigation handled correctly (Android back button, iOS swipe-to-go-back)
- [ ] Status bar and safe area handled via `SafeArea` widget
- [ ] Platform-specific permissions declared in `AndroidManifest.xml` and `Info.plist`

### Responsive design:
- [ ] `LayoutBuilder` or `MediaQuery` used for responsive layouts
- [ ] Breakpoints defined consistently (phone, tablet, desktop)
- [ ] Text doesn't overflow on small screens — use `Flexible`, `Expanded`, `FittedBox`
- [ ] Landscape orientation tested or explicitly locked
- [ ] Web-specific: mouse/keyboard interactions supported, hover states present

---

## 9. Security

### Secure storage:
- [ ] Sensitive data (tokens, credentials) stored using platform-secure storage (Keychain on iOS, EncryptedSharedPreferences on Android)
- [ ] Never store secrets in plaintext storage
- [ ] Biometric authentication gating considered for sensitive operations

### API key handling:
- [ ] API keys NOT hardcoded in Dart source — use `--dart-define`, `.env` files excluded from VCS, or compile-time configuration
- [ ] Secrets not committed to git — check `.gitignore`
- [ ] Backend proxy used for truly secret keys (client should never hold server secrets)

### Input validation:
- [ ] All user input validated before sending to API
- [ ] Form validation uses proper validation patterns
- [ ] No raw SQL or string interpolation of user input
- [ ] Deep link URLs validated and sanitized before navigation

### Network security:
- [ ] HTTPS enforced for all API calls
- [ ] Certificate pinning considered for high-security apps
- [ ] Authentication tokens refreshed and expired properly
- [ ] No sensitive data logged or printed

---

## 10. Package/Dependency Review

### Evaluating pub.dev packages:
- [ ] Check **pub points score** (aim for 130+/160)
- [ ] Check **likes** and **popularity** as community signals
- [ ] Verify the publisher is **verified** on pub.dev
- [ ] Check last publish date — stale packages (>1 year) are a risk
- [ ] Review open issues and response time from maintainers
- [ ] Check license compatibility with your project
- [ ] Verify platform support covers your targets

### Version constraints:
- [ ] Use caret syntax (`^1.2.3`) for dependencies — allows compatible updates
- [ ] Pin exact versions only when absolutely necessary
- [ ] Run `flutter pub outdated` regularly to track stale dependencies
- [ ] No dependency overrides in production `pubspec.yaml` — only for temporary fixes with a comment/issue link
- [ ] Minimize transitive dependency count — each dependency is an attack surface

### Monorepo-specific (melos/workspace):
- [ ] Internal packages import only from public API — no `package:other/src/internal.dart` (breaks Dart package encapsulation)
- [ ] Internal package dependencies use workspace resolution, not hardcoded `path: ../../` relative strings
- [ ] All sub-packages share or inherit root `analysis_options.yaml`

---

## 11. Navigation and Routing

### General principles (apply to any routing solution):
- [ ] One routing approach used consistently — no mixing imperative `Navigator.push` with a declarative router
- [ ] Route arguments are typed — no `Map<String, dynamic>` or `Object?` casting
- [ ] Route paths defined as constants, enums, or generated — no magic strings scattered in code
- [ ] Auth guards/redirects centralized — not duplicated across individual screens
- [ ] Deep links configured for both Android and iOS
- [ ] Deep link URLs validated and sanitized before navigation
- [ ] Navigation state is testable — route changes can be verified in tests
- [ ] Back behavior is correct on all platforms

---

## 12. Error Handling

### Framework error handling:
- [ ] `FlutterError.onError` overridden to capture framework errors (build, layout, paint)
- [ ] `PlatformDispatcher.instance.onError` set for async errors not caught by Flutter
- [ ] `ErrorWidget.builder` customized for release mode (user-friendly instead of red screen)
- [ ] Global error capture wrapper around `runApp` (e.g., `runZonedGuarded`, Sentry/Crashlytics wrapper)

### Error reporting:
- [ ] Error reporting service integrated (Firebase Crashlytics, Sentry, or equivalent)
- [ ] Non-fatal errors reported with stack traces
- [ ] State management error observer wired to error reporting (e.g., BlocObserver, ProviderObserver, or equivalent for your solution)
- [ ] User-identifiable info (user ID) attached to error reports for debugging

### Graceful degradation:
- [ ] API errors result in user-friendly error UI, not crashes
- [ ] Retry mechanisms for transient network failures
- [ ] Offline state handled gracefully
- [ ] Error states in state management carry error info for display
- [ ] Raw exceptions (network, parsing) are mapped to user-friendly, localized messages before reaching the UI — never show raw exception strings to users

---

## 13. Internationalization (l10n)

### Setup:
- [ ] Localization solution configured (Flutter's built-in ARB/l10n, easy_localization, or equivalent)
- [ ] Supported locales declared in app configuration

### Content:
- [ ] All user-visible strings use the localization system — no hardcoded strings in widgets
- [ ] Template file includes descriptions/context for translators
- [ ] ICU message syntax used for plurals, genders, selects
- [ ] Placeholders defined with types
- [ ] No missing keys across locales

### Code review:
- [ ] Localization accessor used consistently throughout the project
- [ ] Date, time, number, and currency formatting is locale-aware
- [ ] Text directionality (RTL) supported if targeting Arabic, Hebrew, etc.
- [ ] No string concatenation for localized text — use parameterized messages

---

## 14. Dependency Injection

### Principles (apply to any DI approach):
- [ ] Classes depend on abstractions (interfaces), not concrete implementations at layer boundaries
- [ ] Dependencies provided externally via constructor, DI framework, or provider graph — not created internally
- [ ] Registration distinguishes lifetime: singleton vs factory vs lazy singleton
- [ ] Environment-specific bindings (dev/staging/prod) use configuration, not runtime `if` checks
- [ ] No circular dependencies in the DI graph
- [ ] Service locator calls (if used) are not scattered throughout business logic

---

## 15. Static Analysis

### Configuration:
- [ ] `analysis_options.yaml` present with strict settings enabled
- [ ] Strict analyzer settings: `strict-casts: true`, `strict-inference: true`, `strict-raw-types: true`
- [ ] A comprehensive lint rule set is included (very_good_analysis, flutter_lints, or custom strict rules)
- [ ] All sub-packages in monorepos inherit or share the root analysis options

### Enforcement:
- [ ] No unresolved analyzer warnings in committed code
- [ ] Lint suppressions (`// ignore:`) are justified with comments explaining why
- [ ] `flutter analyze` runs in CI and failures block merges

### Key rules to verify regardless of lint package:
- [ ] `prefer_const_constructors` — performance in widget trees
- [ ] `avoid_print` — use proper logging
- [ ] `unawaited_futures` — prevent fire-and-forget async bugs
- [ ] `prefer_final_locals` — immutability at variable level
- [ ] `always_declare_return_types` — explicit contracts
- [ ] `avoid_catches_without_on_clauses` — specific error handling
- [ ] `always_use_package_imports` — consistent import style

---

## State Management Quick Reference

The table below maps universal principles to their implementation in popular solutions. Use this to adapt review rules to whichever solution the project uses.

| Principle | BLoC/Cubit | Riverpod | Provider | GetX | MobX | Signals | Built-in |
|-----------|-----------|----------|----------|------|------|---------|----------|
| State container | `Bloc`/`Cubit` | `Notifier`/`AsyncNotifier` | `ChangeNotifier` | `GetxController` | `Store` | `signal()` | `StatefulWidget` |
| UI consumer | `BlocBuilder` | `ConsumerWidget` | `Consumer` | `Obx`/`GetBuilder` | `Observer` | `Watch` | `setState` |
| Selector | `BlocSelector`/`buildWhen` | `ref.watch(p.select(...))` | `Selector` | N/A | computed | `computed()` | N/A |
| Side effects | `BlocListener` | `ref.listen` | `Consumer` callback | `ever()`/`once()` | `reaction` | `effect()` | callbacks |
| Disposal | auto via `BlocProvider` | `.autoDispose` | auto via `Provider` | `onClose()` | `ReactionDisposer` | manual | `dispose()` |
| Testing | `blocTest()` | `ProviderContainer` | `ChangeNotifier` directly | `Get.put` in test | store directly | signal directly | widget test |

---

## Sources

- [Effective Dart: Style](https://dart.dev/effective-dart/style)
- [Effective Dart: Usage](https://dart.dev/effective-dart/usage)
- [Effective Dart: Design](https://dart.dev/effective-dart/design)
- [Flutter Performance Best Practices](https://docs.flutter.dev/perf/best-practices)
- [Flutter Testing Overview](https://docs.flutter.dev/testing/overview)
- [Flutter Accessibility](https://docs.flutter.dev/ui/accessibility-and-internationalization/accessibility)
- [Flutter Internationalization](https://docs.flutter.dev/ui/accessibility-and-internationalization/internationalization)
- [Flutter Navigation and Routing](https://docs.flutter.dev/ui/navigation)
- [Flutter Error Handling](https://docs.flutter.dev/testing/errors)
- [Flutter State Management Options](https://docs.flutter.dev/data-and-backend/state-mgmt/options)
