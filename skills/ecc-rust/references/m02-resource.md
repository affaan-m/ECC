# Resource and pointer selection

Adapted from `bol/m02-resource`.

| Requirement | Starting point |
| --- | --- |
| One owner | Own the value directly |
| Stable heap allocation or recursive size | `Box<T>` |
| Shared ownership on one thread | `Rc<T>` |
| Shared ownership across threads | `Arc<T>` with the required inner-type bounds |
| Back-reference without owning | `Weak<T>` |
| Shared mutation on one thread | `Cell<T>` or `RefCell<T>` |
| Shared mutation across threads | A suitable lock, atomic protocol, or an owning task with messages |

`Arc<T>` makes reference counting thread-safe. It does not make arbitrary `T` thread-safe: `Arc<RefCell<T>>` remains unsuitable for cross-thread sharing. Avoid adding nested wrappers until their distinct ownership and synchronization roles are necessary.

`Weak::upgrade` can fail after the last strong owner is dropped. Handle that as a normal lifecycle state. Break reference cycles deliberately; cycles of strong `Rc`/`Arc` references leak even though the code is memory-safe.

Track operating-system resources by ownership too: prefer `OwnedFd`/`BorrowedFd` or platform equivalents over untracked raw descriptors. Wrapping an already-owned raw handle twice can double-close it.
