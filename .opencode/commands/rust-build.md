---
description: Fix Rust build errors and borrow checker issues
agent: rust-build-resolver
subtask: true
---

# Rust Build Command

Fix Rust build, clippy, and dependency errors: $ARGUMENTS

## Your Task

1. **Run cargo check**: `cargo check 2>&1`
2. **Run cargo clippy**: `cargo clippy -- -D warnings 2>&1`
3. **Fix errors** one at a time
4. **Verify fixes** don't introduce new errors

## Common Rust Errors

### Borrow Checker
```
cannot borrow `x` as mutable because it is also borrowed as immutable
```
**Fix**: Restructure to end immutable borrow first; clone only if justified

### Type Mismatch
```
mismatched types: expected `T`, found `U`
```
**Fix**: Add `.into()`, `as`, or explicit type conversion

### Missing Import
```
unresolved import `crate::module`
```
**Fix**: Fix the `use` path or declare the module (add Cargo.toml deps only for external crates)

### Lifetime Errors
```
does not live long enough
```
**Fix**: Use owned type or add lifetime annotation

### Trait Not Implemented
```
the trait `X` is not implemented for `Y`
```
**Fix**: Add `#[derive(Trait)]` or implement manually

## Fix Order

1. **Build errors** - Code must compile
2. **Clippy warnings** - Fix suspicious constructs
3. **Formatting** - `cargo fmt` compliance

## Build Commands

```bash
cargo check 2>&1
cargo clippy -- -D warnings 2>&1
cargo fmt --check 2>&1
cargo tree --duplicates
cargo test
```

## Verification

After fixes:
```bash
cargo check                  # Should succeed
cargo clippy -- -D warnings  # No warnings allowed
cargo fmt --check            # Formatting should pass
cargo test                   # Tests should pass
```

---

**IMPORTANT**: Fix errors only. No refactoring, no improvements. Get the build green with minimal changes.
