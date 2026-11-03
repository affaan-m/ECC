# Pointer and memory review

Curated from `bol/unsafe-checker` raw-pointer, safety, layout, and initialization rules. The original unsafe example collection is not reproduced because several examples had invalid assumptions.

For every raw dereference or slice/reference constructor, establish:

- The pointer originates from the intended live allocation, and required bounds stay within it.
- The address is aligned for the type and the bytes represent initialized valid values before a reference/read treats them as that type.
- Borrowing and concurrent access obey the abstraction's exclusivity rules for the full reference lifetime.
- Length/offset calculations cannot overflow and satisfy the operation's size constraints.
- Empty and zero-sized cases are handled according to the called API, including non-null/aligned pointer requirements for zero-length slices.

A packed field can be unaligned. Create a raw pointer with `&raw const`/`addr_of!` and use an unaligned read where valid; do not first create a reference and cast it. `repr(C)` alone does not repair misalignment or validate data received from foreign code.

Two raw pointers to the same memory are not automatically a violation. Creating/using references and the actual read/write sequence determine the aliasing obligations; converting a shared reference to a mutable pointer does not grant write permission.

`transmute` requires more than equal size. Check destination validity, ownership, lifetimes, and layout guarantees; different-size direct transmutes are rejected by the compiler rather than executed as runtime UB. Prefer typed conversions and byte parsing for serialized input.

Partial initialization needs an initialized-element count and cleanup that drops each initialized value once. Avoid `Vec::set_len` until elements are initialized. A raw range iterator must account for zero-sized elements; pointer equality is insufficient to count them. Prefer slice iterators unless a concrete requirement justifies reimplementing their invariants.

Safety checks required for a safe method belong in all builds; `debug_assert` cannot uphold a required runtime precondition in release. An unsafe method may instead rely on a documented caller precondition, provided its safe API cannot violate it.
