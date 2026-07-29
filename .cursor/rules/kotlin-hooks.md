---
description: "Kotlin hook usage for Kotlin, Android, and KMP projects. Apply when writing, reviewing, or refactoring hook permissions, automation boundaries, and guardrails."
alwaysApply: false
---
# Kotlin Hooks

> This file extends the common hooks rule with Kotlin-specific content.

## PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **ktfmt/ktlint**: Auto-format `.kt` and `.kts` files after edit
- **detekt**: Run static analysis after editing Kotlin files
- **./gradlew build**: Verify compilation after changes
