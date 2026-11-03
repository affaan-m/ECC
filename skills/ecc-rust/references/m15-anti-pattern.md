# Rust review checklist

Adapted from `bol/m15-anti-pattern` and ECC `rust-patterns`.

Review behavior and invariants before style:

- Do errors retain actionable context, and are failures observed by the task owner?
- Does a clone represent required independent ownership or conceal a lifetime/design problem?
- Can a caller bypass validation through public fields or unchecked constructors?
- Are lock scopes, ordering, cancellation points, and queue bounds clear?
- Are returned references tied to the correct owner without unnecessary `'static` bounds?
- Are supported feature/target combinations and MSRV preserved?
- Is unsafe code justified with an operation-specific safety argument?

Context matters: index loops, owned strings, public data fields, large enums, and `Box<dyn Error>` are not automatically wrong. Refactor them only when there is a concrete correctness, API, maintenance, or measured performance benefit.

Do not use blanket rules such as “all production unwraps are forbidden” or “all types must use getters.” A panic for a proved invariant differs from a panic on untrusted input. A simple public data transfer type differs from an invariant-bearing domain object.

Prefer the repository's Clippy policy. Enabling every pedantic lint in an unrelated change can create churn and suppressions without improving the task's result.
