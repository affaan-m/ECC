# Auto traits and synchronization

Curated from `bol/unsafe-checker` auto-trait, pointer, panic-safety, and guard rules.

Prove `Send` for transferring the whole value and `Sync` for sharing `&Self`. Include the type's generic parameters, references it can expose, internal pointers, allocator/destructor constraints, callbacks, and thread affinity. A lock protecting one field does not establish safety for all other state.

Guard types need their own auto-trait argument. A guard that dereferences to `&T` cannot be `Sync` unless sharing that access is sound. A hand-written spinlock can accidentally let a guard for non-`Sync` data cross threads even though its lock-level `Send`/`Sync` bounds appear reasonable. Prefer established synchronization primitives; do not copy a spinlock example without a complete guard, aliasing, memory-ordering, and panic-safety proof.

Acquire/release ordering must match the actual handoff protocol. `Relaxed` guarantees atomic access to that atomic value but does not publish unrelated data. `SeqCst` does not repair invalid ownership, missing synchronization, or a logical race.

Raw pointers can be transferred by a valid abstraction; a blanket prohibition obscures the actual requirement. Safe operations must prevent concurrent invalidating access and preserve the pointee's lifetime. Wrapping a pointer in a newtype to implement `Send` does not supply those guarantees.

Interrupt masking, thread locks, device atomics, and DMA synchronization solve different problems. Verify the platform and execution contexts the unsafe abstraction actually supports.
