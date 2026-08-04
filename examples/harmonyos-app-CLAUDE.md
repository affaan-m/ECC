# HarmonyOS App Project CLAUDE.md

This is a project-level CLAUDE.md example for HarmonyOS applications. Place it at your project root.

## Project Overview

[Briefly describe your app - features, target devices, API level]

## Core Rules

### 1. Tech Stack Constraints

- Platform: HarmonyOS (ArkTS/TypeScript), prefer latest stable official APIs
- State Management: **V2 only** (`@ComponentV2`, `@Local`, `@Param`, `@Event`, `@Provider`, `@Consumer`, `@Monitor`, `@Computed`)
- Routing: **Navigation only** (`Navigation` + `NavPathStack` + `NavDestination`)
- Architecture: MVVM with modular layers - View renders only, all business logic in ViewModel
- Component priority: in-module reusable components > cross-module shared components > third-party libraries

### 2. Code Organization

- Prefer many small files over few large files
- High cohesion, low coupling
- Target 200-400 lines per file, max 800 lines
- Organize by feature/domain, not by type

### 3. Code Style

- No emojis in code, comments, or documentation
- Immutability - never mutate objects directly
- Double quotes for strings; semicolons required
- Never use `var` - prefer `const`, then `let`
- No `any` type - complete type annotations for all methods, parameters, return values
- Naming: `camelCase` for variables/functions, `PascalCase` for classes/interfaces, `UPPER_SNAKE_CASE` for constants
- File header: `@file` + `@author`; all methods need JSDoc with `@param` and `@returns`

### 4. Layout & Interaction

- Use `layoutWeight(1)` for even distribution - avoid `SpaceAround`/`SpaceBetween`
- Use percentages / layout weights / adaptive units - no hardcoded fixed dimensions (except icons)
- Define UI constants as resources, reference via `$r()`
- Support both light and dark themes for new color resources

### 5. Build & Validation

```bash
# Build HAP package
hvigorw assembleHap -p product=default
```

- Run build after every implementation to verify compilation
- Refer to official Huawei developer docs for uncertain API usage - never guess

### 6. Testing

- TDD: write tests first
- Unit tests for utility functions and ViewModels
- UI tests for critical user flows
- Minimum 80% coverage for business logic

### 7. Security

- No hardcoded secrets
- Verify permissions in `module.json5` before using system APIs
- Validate all user input
- Use HTTPS for all network requests

## File Structure

```
src/
|-- entry/            # App entry, framework initialization
|-- core/             # Core framework layer
|-- shared/           # Shared contracts layer
|-- packages/         # Business feature packages
```

## Available Commands

- `/plan` - Create implementation plan
- `/code-review` - Code quality review
- `/build-fix` - Fix build errors

## Git Workflow

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
- No direct commits to main branch
- PRs require review
- All tests must pass before merge
