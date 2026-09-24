---
description: Review Flutter/Dart code for idiomatic patterns, widget best practices, state management, performance, accessibility, and security. Invokes the flutter-reviewer agent.
---

# Flutter Code Review

This command invokes the **flutter-reviewer** agent to review Flutter/Dart code changes.

## What This Command Does

1. **Gather Context**: Review `git diff --staged` and `git diff`
2. **Inspect Project**: Check `pubspec.yaml`, `analysis_options.yaml`, state management solution
3. **Security Pre-scan**: Check for hardcoded secrets and critical security issues
4. **Full Review**: Apply the complete review checklist
5. **Report Findings**: Output issues grouped by severity with fix guidance

## Prerequisites

Before running `/flutter-review`, ensure:
1. **Build passes** — run `/flutter-build` first; a review on broken code is incomplete
2. **Tests pass** — run `/flutter-test` to confirm no regressions
3. **No merge conflicts** — resolve all conflicts so the diff reflects only intentional changes
4. **`flutter analyze` is clean** — fix analyzer warnings before review

## When to Use

Use `/flutter-review` when:
- Before submitting a PR with Flutter/Dart changes (after build and tests pass)
- After implementing a new feature to catch issues early
- When reviewing someone else's Flutter code
- To audit a widget, state management component, or service class
- Before a production release

## Review Areas

| Area | Severity |
|------|----------|
| Hardcoded secrets, cleartext HTTP | CRITICAL |
| Architecture violations, state management anti-patterns | CRITICAL |
| Widget rebuild issues, resource leaks | HIGH |
| Missing `dispose()`, `BuildContext` after await | HIGH |
| Dart null safety, missing error/loading states | HIGH |
| Const propagation, widget composition | HIGH |
| Performance: expensive work in `build()` | HIGH |
| Accessibility, semantic labels | MEDIUM |
| Missing tests for state transitions | HIGH |
| Hardcoded strings (l10n) | MEDIUM |
| Pub dependency hygiene | LOW |

## Example Session

````text
User: /flutter-review

Agent:
# Flutter Code Review

## Context

Changed files:
- lib/features/auth/presentation/login_page.dart
- lib/features/auth/data/auth_repository_impl.dart

State management: Riverpod (detected from pubspec.yaml)
Architecture: feature-first

## Security Pre-scan

✓ No hardcoded secrets detected
✓ No cleartext HTTP calls

## Review Findings

[HIGH] BuildContext used after async gap without mounted check
File: lib/features/auth/presentation/login_page.dart:67
Issue: `context.go('/home')` called after `await auth.login(...)` with no `mounted` check.
Fix: Add `if (!context.mounted) return;` before any navigation after awaits (Flutter 3.7+).

[HIGH] AsyncValue error state not handled
File: lib/features/auth/presentation/login_page.dart:42
Issue: `ref.watch(authProvider)` switches on loading/data but has no `error` branch.
Fix: Add error case to the switch expression or `when()` call to show a user-facing error message.

[MEDIUM] Hardcoded string not localized
File: lib/features/auth/presentation/login_page.dart:89
Issue: `Text('Login')` — user-visible string not using localization system.
Fix: Use the project's l10n accessor: `Text(context.l10n.loginButton)`.

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0     | pass   |
| HIGH     | 2     | block  |
| MEDIUM   | 1     | info   |
| LOW      | 0     | note   |

Verdict: BLOCK — HIGH issues must be fixed before merge.
````

## Approval Criteria

- **Approve**: No CRITICAL or HIGH issues
- **Block**: Any CRITICAL or HIGH issues must be fixed before merge

## Related Commands

- `/flutter-build` — Fix build errors first
- `/flutter-test` — Run tests before reviewing
- `/code-review` — General code review (language-agnostic)

## Related

- Agent: `agents/flutter-reviewer.md`
- Skill: `skills/flutter-dart-code-review/`
- Rules: `rules/dart/`
