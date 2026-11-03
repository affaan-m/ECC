# Type-driven design

Adapted from `bol/m05-type-driven`.

Use a newtype when the compiler should distinguish units or validated values. Keep invariant-bearing fields private and expose fallible constructors; a public tuple field lets callers bypass validation.

```rust
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Port(std::num::NonZeroU16);

impl Port {
    pub fn new(value: u16) -> Option<Self> {
        std::num::NonZeroU16::new(value).map(Self)
    }

    pub fn get(self) -> u16 {
        self.0.get()
    }
}
```

Use enums for a closed set of runtime states. Typestate can make invalid method ordering unrepresentable when transitions consume the old state; it becomes cumbersome when callers need heterogeneous states or persistent serialization. Choose based on the actual API, not pattern preference.

`PhantomData` affects variance, drop checking, and auto traits; it is not merely a way to silence an unused generic parameter. Its type must represent the abstraction's actual ownership or borrowing relationship.

A builder should validate cross-field invariants at `build`. Do not make every field optional in the final domain type simply because the builder assembles values incrementally.
