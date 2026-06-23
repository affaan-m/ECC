---
inclusion: fileMatch
fileMatchPattern: "*.rs"
description: Rust-specific patterns, ownership, lifetimes, error handling, and best practices.
---

# Rust Patterns

> This file extends the common patterns with Rust specific content.

## Formatting & Linting

- Run `cargo fmt` before committing
- Run `cargo clippy -- -D warnings` (treat warnings as errors)

## Immutability & Ownership

- Use `let` by default; only `let mut` when mutation is required
- Borrow (`&T`) by default; take ownership only when storing or consuming
- Accept `&str` over `String`, `&[T]` over `Vec<T>` in function parameters
- Never clone to satisfy the borrow checker without understanding the root cause

```rust
// GOOD — borrows when ownership isn't needed
fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

// GOOD — takes ownership in constructor via Into
fn new(name: impl Into<String>) -> Self {
    Self { name: name.into() }
}
```

## Error Handling

- Use `Result<T, E>` and `?` for propagation — never `unwrap()` in production code
- Libraries: define typed errors with `thiserror`
- Applications: use `anyhow` for flexible error context
- Reserve `unwrap()` / `expect()` for tests and truly unreachable states

```rust
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("failed to read config: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid config format: {0}")]
    Parse(String),
}
```

## Newtype Pattern

Prevent argument mix-ups with distinct wrapper types:

```rust
struct UserId(u64);
struct OrderId(u64);

fn get_order(user: UserId, order: OrderId) -> anyhow::Result<Order> {
    todo!()
}
```

## Enum State Machines

Model states as enums — make illegal states unrepresentable:

```rust
enum ConnectionState {
    Disconnected,
    Connecting { attempt: u32 },
    Connected { session_id: String },
    Failed { reason: String, retries: u32 },
}
```

Always match exhaustively — no wildcard `_` for business-critical enums.

## Repository Pattern with Traits

```rust
pub trait OrderRepository: Send + Sync {
    fn find_by_id(&self, id: u64) -> Result<Option<Order>, StorageError>;
    fn save(&self, order: &Order) -> Result<Order, StorageError>;
    fn delete(&self, id: u64) -> Result<(), StorageError>;
}
```

## Security

- Never hardcode secrets — use `std::env::var("API_KEY")`
- Always use parameterized queries (sqlx, diesel, sea-orm)
- Minimize `unsafe` blocks; every `unsafe` must have a `// SAFETY:` comment
- Run `cargo audit` and `cargo deny check` in CI

## Testing

- Unit tests in `#[cfg(test)]` modules in the same file
- Integration tests in `tests/` directory
- Use `rstest` for parameterized tests, `mockall` for trait mocking
- Target 80%+ coverage with `cargo llvm-cov`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_user_with_valid_email() {
        let user = User::new("Alice", "alice@example.com").unwrap();
        assert_eq!(user.name, "Alice");
    }
}
```

## Module Organization

Organize by domain, not by type. Default to private; use `pub(crate)` for internal sharing.

## Reference

See agents: `rust-reviewer`, `rust-build-resolver` for Rust-specific review and build error resolution.
