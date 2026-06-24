---
description: Comprehensive Rust code review for ownership, lifetimes, error handling, unsafe usage, and idiomatic patterns. Invokes the rust-reviewer agent.
---

# Rust Code Review

This command invokes the **rust-reviewer** agent for comprehensive Rust-specific code review.

## What This Command Does

1. **Verify Automated Checks**: Run `cargo check`, `cargo clippy -- -D warnings`, `cargo fmt --check`, and `cargo test` — stop if any fail
2. **Identify Rust Changes**: Find modified `.rs` files via `git diff HEAD~1` (or `git diff main...HEAD` for PRs)
3. **Run Security Audit**: Execute `cargo audit` if available
4. **Security Scan**: Check for unsafe usage, command injection, hardcoded secrets
5. **Ownership Review**: Analyze unnecessary clones, lifetime issues, borrowing patterns
6. **Generate Report**: Categorize issues by severity

## When to Use

Use `/rust-review` when:
- After writing or modifying Rust code
- Before committing Rust changes
- Reviewing pull requests with Rust code
- Onboarding to a new Rust codebase
- Learning idiomatic Rust patterns

## Review Categories

### CRITICAL (Must Fix)
- Unchecked `unwrap()`/`expect()` in production code paths
- `unsafe` without `// SAFETY:` comment documenting invariants
- SQL injection via string interpolation in queries
- Command injection via unvalidated input in `std::process::Command`
- Hardcoded credentials
- Use-after-free via raw pointers

### HIGH (Should Fix)
- Unnecessary `.clone()` to satisfy borrow checker
- `String` parameter where `&str` or `impl AsRef<str>` suffices
- Blocking in async context (`std::thread::sleep`, `std::fs`)
- Missing `Send`/`Sync` bounds on shared types
- Wildcard `_ =>` match on business-critical enums
- Large functions (>50 lines)

### MEDIUM (Consider)
- Unnecessary allocation in hot paths
- Missing `with_capacity` when size is known
- Suppressed clippy warnings without justification
- Public API without `///` documentation
- Consider `#[must_use]` on non-`must_use` return types where ignoring values is likely a bug

## Automated Checks Run

```bash
# Build gate (must pass before review)
cargo check

# Lints and suggestions
cargo clippy -- -D warnings

# Formatting
cargo fmt --check

# Tests
cargo test

# Security audit (if available)
if command -v cargo-audit >/dev/null; then cargo audit; else echo "cargo-audit not installed"; fi
```

## Example Usage

````text
User: /rust-review

Agent:
# Rust Code Review Report

## Files Reviewed
- src/service/user.rs (modified)
- src/handler/api.rs (modified)

## Static Analysis Results
- Build: Successful
- Clippy: No warnings
- Formatting: Passed
- Tests: All passing

## Issues Found

[CRITICAL] Unchecked unwrap in Production Path
File: src/service/user.rs:28
Issue: Using `.unwrap()` on database query result
```rust
let user = db.find_by_id(id).unwrap();  // Panics on missing user
```
Fix: Propagate error with context
```rust
let user = db.find_by_id(id)
    .context("failed to fetch user")?;
```

[HIGH] Unnecessary Clone
File: src/handler/api.rs:45
Issue: Cloning String to satisfy borrow checker
```rust
let name = user.name.clone();
process(&user, &name);
```
Fix: Restructure to avoid clone
```rust
let result = process_name(&user.name);
use_user(&user, result);
```

## Summary
- CRITICAL: 1
- HIGH: 1
- MEDIUM: 0

Recommendation: Block merge until CRITICAL issue is fixed
````

## Approval Criteria

| Status | Condition |
|--------|-----------|
| Approve | No CRITICAL or HIGH issues |
| Warning | Only MEDIUM issues (merge with caution) |
| Block | CRITICAL or HIGH issues found |

## Integration with Other Commands

- Use `/rust-test` first to ensure tests pass
- Use `/rust-build` if build errors occur
- Use `/rust-review` before committing
- Use `/code-review` for non-Rust-specific concerns

## Related

- Agent: `agents/rust-reviewer.md`
- Skills: `skills/rust-patterns/`, `skills/rust-testing/`
