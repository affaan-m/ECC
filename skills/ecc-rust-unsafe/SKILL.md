---
name: ecc-rust-unsafe
description: Review unsafe Rust, raw pointers, FFI, memory layout, and manual Send or Sync implementations for soundness and Rust 2024 compatibility.
---

# Unsafe Rust and FFI

Start from the abstraction's contract and enumerate which caller, constructor, operation, and destructor establishes each safety invariant. Keep unsafe operations narrowly scoped. A `SAFETY` comment must explain why the required preconditions hold at that operation, not merely state that unsafe was necessary.

For pointer/reference creation, account for provenance, allocation bounds, alignment, initialization, valid bit patterns, aliasing, lifetime, and concurrent access. Null checks and `NonNull<T>` prove only non-nullness. `repr(C)` describes layout compatibility; it does not make an arbitrary pointer aligned or a foreign value valid.

`MaybeUninit<T>` permits storing uninitialized bytes without treating them as a valid `T`. `assume_init` requires a fully initialized valid value; wrapping invalid data does not make it valid. Do not expose uninitialized memory through a safe slice or reference.

For FFI, verify ABI, symbol signature, ownership transfer, allocation/free pairing, thread affinity, callback lifetime, and unwind policy. A generated binding is not a soundness proof. In Rust 2024, use `unsafe extern` blocks, explicit unsafe blocks inside unsafe functions, and the required unsafe-attribute syntax.

Review manual `Send`/`Sync` implementations against all safe operations, generic bounds, guards, callbacks, and destruction. Allocator thread safety alone does not make a foreign object transferable. Check zero-sized types, empty buffers, partial initialization, panic paths, and cancellation where the abstraction supports them.

Read only the relevant reference:

- For pointer validity, references, packed fields, and initialized storage, read [Memory review](references/memory.md).
- For foreign resources, strings, callbacks, and unwind boundaries, read [FFI review](references/ffi.md).
- For synchronization and auto-trait implementations, read [Concurrency review](references/concurrency.md).
- For a behavior-based review and validation checklist, read [Review checklist](references/review.md).

Use existing tests and appropriate supported Miri/sanitizer runs when available. These find classes of defects; passing them is not a proof of soundness. Report unsupported code paths or tool limitations. Do not install toolchains or rewrite an abstraction merely to tick a generic checklist.
