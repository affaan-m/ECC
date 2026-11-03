# Mutability and borrow conflicts

Adapted from `bol/m03-mutability`.

E0499/E0502 usually require changing overlapping access, not a stronger annotation. Narrow a borrow's scope, compute a value before mutating, split disjoint slices with `split_at_mut`, or use an API such as `HashMap::entry` that represents the intended update without a second lookup.

Interior mutability moves part of the invariant into runtime synchronization:

| Type | Important constraint |
| --- | --- |
| `Cell<T>` | Moves/copies values; does not hand out ordinary mutable references through shared access |
| `RefCell<T>` | Runtime borrow checks; conflicting `borrow` calls panic, `try_borrow` returns an error |
| `Mutex<T>` | Protect the whole invariant, not one arbitrarily chosen field |
| `RwLock<T>` | Read-heavy workloads may benefit; fairness and contention depend on implementation |
| Atomics | Individual atomicity does not prove a multi-field protocol correct |

Immutable bindings, shared references, and immutable data structures are different concepts. Choose the minimal mutation boundary that fits ownership; do not rebuild collections solely to avoid ordinary local mutation.

Release a lock before reentrant callbacks or unrelated I/O. Keep a documented lock order when operations require several locks. Handle poisoning according to whether the protected invariant can be recovered; blindly extracting a poisoned value can expose inconsistent state.
