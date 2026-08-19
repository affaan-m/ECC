# Coding Style

## Immutability (CRITICAL)

ALWAYS create new objects, NEVER mutate existing ones:

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
- **Count code lines, not total lines.** Exclude comment-only and blank lines before
  comparing against any threshold. A file dense with hard-won explanation is not a large
  file; taxing documentation at the same rate as code makes people delete the
  explanations first — which is the opposite of what you want.
- **~200 code lines typical. 400 code lines is where you owe a written reason, not
  where you stop.**
- **A type should not hold more than two independent lifecycles** (tasks, subscriptions,
  timers, observers). Past that it is coordinating, not holding state — extract the
  coordinator. This signal fires earlier and far more accurately than any line count:
  bugs cluster in the interleaving of independent lifecycles, not in line 401.
- Extract utilities from large modules
- Organize by feature/domain, not by type

A line threshold is a **smoke alarm, not a fire code** — its only job is to make someone
look, and the value comes from what they find. **Never satisfy it by moving code between
files or by compressing comments.** That is gaming the metric, not meeting it. Split by
responsibility or don't split.

Check the whole repo mechanically — never a hand-listed set of "suspects", which is how a
breached limit gets reported as satisfied by everyone who looks at it:

```bash
# Adjust the file glob and the comment pattern per language.
find src tests -name '*.ext' | while read -r f; do
  n=$(grep -vcE '^[[:space:]]*(//|#|\*|$)' "$f"); [ "$n" -gt 400 ] && echo "$n $f"
done
```

## Error Handling

ALWAYS handle errors comprehensively:
- Handle errors explicitly at every level
- Provide user-friendly error messages in UI-facing code
- Log detailed error context on the server side
- Never silently swallow errors

## Input Validation

ALWAYS validate at system boundaries:
- Validate all user input before processing
- Use schema-based validation where available
- Fail fast with clear error messages
- Never trust external data (API responses, user input, file content)

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
- [ ] No type holds more than two independent lifecycles (tasks/subscriptions/observers)
- [ ] Files are focused (<400 **code** lines, comments excluded; over that, a written reason)
- [ ] No deep nesting (>4 levels)
- [ ] Proper error handling
- [ ] No hardcoded values (use constants or config)
- [ ] No mutation (immutable patterns used)
