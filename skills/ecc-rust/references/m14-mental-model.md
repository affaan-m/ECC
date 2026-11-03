# Explaining Rust's model

Adapted from `bol/m14-mental-model`.

Explain the failing data flow first: where a value is created, where ownership moves, which references remain live, and when the owner is dropped. Small concrete examples are more useful than imposing a multi-layer reasoning template on every answer.

- Ownership is responsibility for a value's lifetime, not a claim that every value lives on the heap.
- A reference is a constrained access path. Lifetime parameters describe relationships between access paths; they do not prolong allocations.
- Mutable access requires exclusivity during the relevant borrow. An immutable binding can still contain interior mutability.
- `Copy` permits implicit bitwise copies with value semantics; `Clone` is an explicit operation whose cost and sharing behavior depend on the type.
- Async execution is suspension and resumption of state; it does not imply a separate thread or automatic parallelism.
- Pinning constrains movement of the pointee through the pinning API; moving a `Pin<Box<T>>` value does not move its heap allocation.

When comparing languages, use the actual question's constraints and identify where an analogy stops applying. Do not turn a learning explanation into an unrelated architectural rewrite.
