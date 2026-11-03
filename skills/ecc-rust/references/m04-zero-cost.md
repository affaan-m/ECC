# Traits, generics, and dispatch

Adapted from `bol/m04-zero-cost`.

| Choice | Tradeoff |
| --- | --- |
| Generic `T: Trait` | Static dispatch and monomorphization; can increase compilation time and binary size |
| Argument-position `impl Trait` | A generic parameter with concise syntax |
| Return-position `impl Trait` | Hides one concrete return type; branches must agree on that type |
| `dyn Trait` behind a pointer/reference | Runtime dispatch and erased type; useful for heterogeneous implementations |
| Enum of known implementations | Closed set with explicit matching; often useful for protocol states |

For E0277, inspect the trait's required bounds and the actual contained types. For E0599, distinguish missing trait imports, unsatisfied bounds, disabled crate features, and nonexistent methods in the pinned version. E0308 can expose genuinely different types or different versions of the same crate.

Dyn compatibility has restrictions: generic methods and methods returning unconstrained `Self` cannot generally be invoked through a trait object. A `where Self: Sized` method may remain on a trait while being excluded from dynamic calls. Consult the compiler's specific diagnostic rather than adding `Box` mechanically.

Prefer functions and generics to macros when ordinary type checking expresses the requirement. Inline annotations are optimization hints, not proof that abstraction is free; verify generated behavior only when a measured hot path warrants it.
