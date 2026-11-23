# Type-Level Testing

Type-assertion rules for the `typescript-patterns` skill.

## Assert the Types, Not Just the Runtime

Behavior tests prove runtime behavior; dedicated type tests lock in the public API contract. A type that silently loosens is a regression.

```typescript
import { expectTypeOf } from 'vitest'

expectTypeOf<Result<User, ValidationIssue[]>>().toEqualTypeOf<
  | { ok: true; value: User }
  | { ok: false; error: ValidationIssue[] }
>()
```

## Use `satisfies` to Preserve Intent

`satisfies` checks a value against a shape without widening it to that shape — the ideal way to keep literal types while still validating structure.

```typescript
const statusByAction = {
  new: 'open',
  reopen: 'open',
  close: 'closed'
} as const satisfies Record<Action, Status>
```
