---
description: Rust TDD workflow with unit and property tests
agent: tdd-guide
subtask: true
---

# Rust Test Command

Implement using Rust TDD methodology: $ARGUMENTS

## Your Task

Apply test-driven development with Rust idioms:

1. **Define types** - Structs, enums, traits
2. **Write tests** - Unit tests in `#[cfg(test)]` modules
3. **Implement minimal code** - Pass the tests
4. **Check coverage** - Target 80%+

## TDD Cycle for Rust

### Step 1: Define Interface
```rust
pub struct Input {
    // fields
}

pub fn process(input: &Input) -> Result<Output, Error> {
    todo!()
}
```

### Step 2: Write Tests
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_input_succeeds() {
        let input = Input { /* ... */ };
        let result = process(&input);
        assert!(result.is_ok());
    }

    #[test]
    fn invalid_input_returns_error() {
        let input = Input { /* ... */ };
        let result = process(&input);
        assert!(result.is_err());
    }
}
```

### Step 3: Run Tests (RED)
```bash
cargo test
```

### Step 4: Implement (GREEN)
```rust
pub fn process(input: &Input) -> Result<Output, Error> {
    // Minimal implementation that handles both paths
    validate(input)?;
    Ok(Output { /* ... */ })
}
```

### Step 5: Check Coverage
```bash
cargo llvm-cov
cargo llvm-cov --fail-under-lines 80
```

## Rust Testing Commands

```bash
cargo test                        # Run all tests
cargo test -- --nocapture         # Show println output
cargo test test_name              # Run specific test
cargo test --no-fail-fast         # Don't stop on first failure
cargo test --lib                  # Unit tests only
cargo test --test integration     # Integration tests only
cargo test --doc                  # Doc tests only
cargo bench                       # Run benchmarks
```

## Test File Organization

```
src/
├── lib.rs             # Library root
├── service.rs         # Implementation
└── service/
    └── tests.rs       # Or inline #[cfg(test)] mod tests {}
tests/
└── integration.rs     # Integration tests
benches/
└── benchmark.rs       # Criterion benchmarks
```

---

**TIP**: Use `rstest` for parameterized tests and `proptest` for property-based testing.
