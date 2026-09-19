---
description: Fix Rust build errors, borrow checker issues, and dependency problems incrementally. Invokes the rust-build-resolver agent for minimal, surgical fixes.
---

# Rust Build and Fix

This command invokes the **rust-build-resolver** agent to incrementally fix Rust build errors with minimal changes.

## What This Command Does

1. **Run Diagnostics**: Execute `cargo check`, `cargo clippy`, `cargo fmt --check`
2. **Parse Errors**: Identify error codes and affected files
3. **Fix Incrementally**: One error at a time
4. **Verify Each Fix**: Re-run `cargo check` after each change
5. **Report Summary**: Show what was fixed and what remains

## When to Use

Use `/rust-build` when:
- `cargo build` or `cargo check` fails with errors
- `cargo clippy` reports warnings
- Borrow checker or lifetime errors block compilation
- Cargo dependency resolution fails
- After pulling changes that break the build

## Diagnostic Commands Run

```bash
# Primary build check
cargo check 2>&1

# Lints and suggestions
cargo clippy -- -D warnings 2>&1

# Formatting check
cargo fmt --check 2>&1

# Dependency issues
cargo tree --duplicates

# Security audit (if available)
if command -v cargo-audit >/dev/null; then cargo audit; else echo "cargo-audit not installed"; fi
```

## Example Session

````text
User: /rust-build

Agent:
# Rust Build Resolution

## Initial Diagnostics

```bash
$ cargo check
error[E0502]: cannot borrow `map` as mutable because it is also borrowed as immutable
  --> src/service/cache.rs:25:5
error[E0308]: mismatched types
  --> src/handler/api.rs:42:12
error[E0425]: cannot find value `db` in this scope
  --> src/handler/api.rs:58:9
```

Errors found: 3

## Fix 1: Borrow Checker Error

File: src/service/cache.rs:25
Error: E0502 — cannot borrow `map` as mutable because also borrowed as immutable
Cause: Immutable borrow still active during mutable insert

```rust
// Changed: restructured to end immutable borrow before mutable access
if !map.contains_key("key") {
    map.insert("key".into(), default);
}
```

```bash
$ cargo check
# 2 errors remaining
```

## Fix 2: Type Mismatch

File: src/handler/api.rs:42
Error: E0308 — mismatched types: expected `usize`, found `&str`

```rust
// Changed
let count = params.get("count");
// To
let count: usize = params.get("count")
    .and_then(|s| s.parse().ok())
    .unwrap_or(0);
```

```bash
$ cargo check
# 1 error remaining
```

## Fix 3: Unresolved Name

File: src/handler/api.rs:58
Error: E0425 — cannot find value `db` in this scope
Cause: Missing import

```rust
// Added
use crate::db;
```

```bash
$ cargo check
# Build successful!
```

## Final Verification

```bash
$ cargo clippy -- -D warnings
# No warnings

$ cargo test
running 6 tests
test service::cache::tests::test_insert ... ok
test service::cache::tests::test_get ... ok
test handler::api::tests::test_parse_count ... ok
test handler::api::tests::test_missing_count ... ok
test handler::api::tests::test_db_import ... ok
test handler::api::tests::test_response ... ok

test result: ok. 6 passed; 0 failed; 0 ignored
```

## Summary

| Metric | Count |
|--------|-------|
| Build errors fixed | 3 |
| Clippy warnings fixed | 0 |
| Files modified | 2 |
| Remaining issues | 0 |

Build Status: SUCCESS
````

## Common Errors Fixed

| Error | Typical Fix |
|-------|-------------|
| `cannot borrow as mutable` | Restructure to end immutable borrow first; clone only if justified |
| `does not live long enough` | Use owned type or add lifetime annotation |
| `cannot move out of` | Restructure to take ownership; clone only as last resort |
| `mismatched types` | Add `.into()`, `as`, or explicit conversion |
| `trait X not implemented` | Add `#[derive(Trait)]` or implement manually |
| `unresolved import` | Add to Cargo.toml or fix `use` path |
| `cannot find value` | Add import or fix path |

## Fix Strategy

1. **Build errors first** - Code must compile
2. **Clippy warnings second** - Fix suspicious constructs
3. **Formatting third** - `cargo fmt` compliance
4. **One fix at a time** - Verify each change
5. **Minimal changes** - Don't refactor, just fix

## Stop Conditions

The agent will stop and report if:
- Same error persists after 3 attempts
- Fix introduces more errors
- Requires architectural changes
- Borrow checker error requires redesigning data ownership

## Related Commands

- `/rust-test` - Run tests after build succeeds
- `/rust-review` - Review code quality
- `verification-loop` skill - Full verification loop

## Related

- Agent: `agents/rust-build-resolver.md`
- Skill: `skills/rust-patterns/`
