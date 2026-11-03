# Domain modeling

Adapted from `bol/m09-domain`.

Model invariants at the smallest ownership boundary that can preserve them. A value object represents a validated value; an entity has identity beyond its current fields; an aggregate owns changes that must succeed together. These are useful distinctions, not a mandate for repository layers in every crate.

Keep invalid states out of the public API with private fields, enums, and checked constructors. Validation should distinguish syntactic acceptance from domain validity. An email-shaped string, for example, is not proof that a mailbox exists.

Choose borrowing and shared ownership from actual lifetimes. A domain object should not inherit a database transaction's lifetime accidentally just because it was loaded there. Crossing a subsystem boundary may justify an owned transfer object.

Keep persistence concerns separate when that supports testing or changing storage. Avoid a generic repository abstraction that obscures a concrete query's transaction, batching, or consistency requirements.
