# Ownership and lifetimes

Adapted from `bol/m01-ownership` and its lifetime/error examples.

| Symptom | What to establish before changing code |
| --- | --- |
| E0382: use after move | Which operation consumes the value, and who needs ownership afterward? |
| E0597/E0716: borrowed value or temporary too short-lived | Does the owner outlive every use of the borrow? Bind the owner, or return owned data. |
| E0515: reference to local data | Return the value or its owner; lifetime annotations cannot extend storage duration. |
| E0507: move through a borrow | Borrow a field, use `take`/`replace` when a valid replacement exists, or redesign the consuming API. |
| E0106: ambiguous returned lifetime | Identify the input that owns the returned data and express that relationship. |

Use `&T` for inspection, `&mut T` for exclusive mutation, and `T` when the callee consumes or retains the value. Prefer slices and `&str` at borrowing boundaries; retain concrete owned collections when their capacity or mutation APIs matter.

`Clone` is valid when independent ownership is required. `Arc::clone` shares an allocation and increments a reference count; it does not clone the inner value. Do not replace one with the other without checking semantics.

`T: 'static` means `T` contains no references shorter than `'static`; it does not mean an instance lives forever. Ordinary owned values can satisfy it and still be dropped normally. A `move` closure can still capture a short-lived reference, so `move` alone does not prove `'static`.

For lifetime API examples, read [Lifetime patterns](patterns/lifetimes.md).
