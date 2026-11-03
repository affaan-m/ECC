# Lifetime API patterns

Adapted from `bol/m01-ownership/patterns/lifetime-patterns.md`.

When a result can borrow either of two inputs, its lifetime must fit both:

```rust
pub fn longer<'a>(left: &'a str, right: &'a str) -> &'a str {
    if left.len() >= right.len() { left } else { right }
}
```

When the result always borrows one input, keep unrelated inputs independent:

```rust
pub fn prefix_before<'a>(text: &'a str, separator: &str) -> &'a str {
    text.split_once(separator).map_or(text, |(prefix, _)| prefix)
}
```

Method lifetime elision usually ties a returned reference to the borrow of `self`. A type storing `&'src str` can deliberately return `&'src str` when the backing data outlives that borrow:

```rust
pub struct Excerpt<'src> {
    text: &'src str,
}

impl<'src> Excerpt<'src> {
    pub fn new(text: &'src str) -> Self {
        Self { text }
    }

    pub fn text(&self) -> &'src str {
        self.text
    }
}
```

Do not make a self-referential struct by storing a reference to another owned field. Prefer offsets, stable external ownership, or an established abstraction with a reviewed pinning invariant. A lifetime parameter alone cannot make that storage layout sound.
