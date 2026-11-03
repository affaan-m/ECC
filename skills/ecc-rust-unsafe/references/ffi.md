# Foreign resource and callback review

Curated from `bol/unsafe-checker` FFI and I/O rules.

Record the foreign function's actual contract, not just its generated declaration:

| Boundary | Required evidence |
| --- | --- |
| Foreign pointer returned to Rust | Allocation size/alignment, initialization, null behavior, ownership, and destructor |
| Rust memory passed to foreign code | Whether it is retained, mutated, reallocated, or accessed on another thread |
| C string | Encoding/interior-NUL policy, terminator, lifetime, and allocation/free pairing |
| Callback plus context pointer | Registration lifetime, thread/reentrancy behavior, and synchronization with unregistration |
| File/socket handle | Whether ownership is borrowed or transferred and who closes it |
| Struct/enum boundary | ABI layout, padding, valid discriminants, and foreign integer/boolean representation |

Keep `CString` alive while C uses `as_ptr`. Use `into_raw` only for a deliberate ownership protocol; `CString::from_raw` is valid only under its matching reconstruction contract, not for any pointer returned by C.

A safe wrapper must prevent mutation, destruction, or asynchronous callbacks from invalidating references it returns. A non-null foreign allocation is not evidence that its bytes are initialized. Expose `MaybeUninit` or initialize through the documented API before creating a typed reference.

Do not derive `Clone` for a uniquely owned foreign pointer. If cloning is supported, call the foreign retain/duplicate operation and pair every ownership claim with the correct release. Ordinary omission of `Clone` is sufficient; `impl !Clone` is not the stable way to express this design.

Use `OwnedFd`/`BorrowedFd` and analogous platform types for ownership-aware APIs. Constructing an owned wrapper from a raw handle is unsafe because ownership must be unique. An invalid descriptor often produces an OS error; descriptor reuse and violated I/O-safety contracts remain serious hazards without claiming every failed OS call is language UB.

Define unwind behavior from the ABI. A Rust panic reaching a non-unwinding C ABI boundary generally aborts; it is not a recoverable error return. `catch_unwind` catches unwinding Rust panics, not aborting panics or every foreign exception. Use an appropriate ABI only when both sides support its unwind contract.
