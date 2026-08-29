# Coding Style

## Immutability

Prefer creating new objects over mutating existing ones:

```
// Pseudocode
WRONG:  modify(original, field, value) → changes original in-place
CORRECT: update(original, field, value) → returns new copy with change
```

Rationale: Immutable data prevents hidden side effects, makes debugging easier, and enables safe concurrency.

## Core Principles

### KISS (Keep It Simple)

- Prefer the simplest solution that actually works
- Avoid premature optimization
- Optimize for clarity over cleverness

### DRY (Don't Repeat Yourself)

- Extract repeated logic into shared functions or utilities
- Avoid copy-paste implementation drift
- Introduce abstractions when repetition is real, not speculative

### YAGNI (You Aren't Gonna Need It)

- Do not build features or abstractions before they are needed
- Avoid speculative generality
- Start simple, then refactor when the pressure is real

## File Organization

MANY SMALL FILES > FEW LARGE FILES:
- High cohesion, low coupling
- 200-400 lines typical, with 800 lines as a soft maintainability ceiling for source files
- Test, generated, and vendored files may exceed the ceiling when their size is justified by their role
- Extract utilities from large modules
- Organize by feature/domain, not by type

## Error Handling

Handle errors explicitly; don't silently swallow them:
- Provide user-friendly error messages in UI-facing code
- Log detailed error context on the server side
- Trust internal code and framework guarantees — comprehensive
  handling belongs at system boundaries, not on every internal call

## Input Validation

Validate at system boundaries (user input, external APIs, file
content):
- Use schema-based validation where available
- Fail fast with clear error messages
- Don't trust external data; don't add validation for internal
  scenarios that cannot happen

## Naming Conventions

- Variables and functions: `camelCase` with descriptive names
- Booleans: prefer `is`, `has`, `should`, or `can` prefixes
- Interfaces, types, and components: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Custom hooks: `camelCase` with a `use` prefix

## Code Smells to Avoid

### Deep Nesting

Prefer early returns over nested conditionals once the logic starts stacking.

### Magic Numbers

Use named constants for meaningful thresholds, delays, and limits.

### Long Functions

Split large functions into focused pieces with clear responsibilities.

## Code Quality Checklist

Before marking work complete:
- [ ] Code is readable and well-named
- [ ] Functions are small (<50 lines)
- [ ] Source files are focused (under the 800-line soft ceiling, or a reason is stated for a deliberate exception)
- [ ] No deep nesting (>4 levels)
- [ ] Proper error handling
- [ ] No hardcoded values (use constants or config)
- [ ] No mutation (immutable patterns used)
