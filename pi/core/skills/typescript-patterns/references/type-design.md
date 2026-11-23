# Type Design

Type-shape rules for the `typescript-patterns` skill.

## Interfaces vs. Type Aliases

`interface` for object shapes that may be extended or implemented; `type` for unions, intersections, tuples, mapped types, and utility types. Prefer string-literal unions over `enum` unless you need runtime value enumeration or interop with code that requires it.

```typescript
interface User {
  id: string
  email: string
}

type UserRole = 'admin' | 'member'
type AdminUser = User & { role: 'admin' }
```

## Discriminated Unions Are the Default State Machine

When a value can be in multiple shapes, model it as a discriminated union with a literal `type`/`kind` field. Exhaustive checking then becomes a free compiler feature: never a runtime fallback, always a compile error on a missing branch.

```typescript
type Transaction =
  | { kind: 'draft'; id: string }
  | { kind: 'submitted'; id: string; submittedAt: Date }
  | { kind: 'paid'; id: string; paidAt: Date; amountCents: number }

function describe(t: Transaction): string {
  switch (t.kind) {
    case 'draft':
      return 'Saved but not sent'
    case 'submitted':
      return `Submitted on ${t.submittedAt.toISOString()}`
    case 'paid':
      return `Paid ${t.amountCents} cents on ${t.paidAt.toISOString()}`
    default:
      // exhaustive: any new member forces this to fail to compile
      return assertNever(t)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled member: ${JSON.stringify(value)}`)
}
```

## Brands and Nominal Safety Where Structure Is Not Enough

Structural typing cannot tell `CustomerId` from `string`. When an ID or unit must not be confused with another, add a brand (a phantom field with a unique symbol key).

```typescript
declare const brand: unique symbol

export type CustomerId = string & { [brand]: 'CustomerId' }

function ensureCustomerId(value: string): CustomerId {
  if (!/^cus_[a-z0-9]+$/.test(value)) {
    throw new TypeError(`Invalid customer id: ${value}`)
  }
  return value as CustomerId
}
```

Keep brands internal to a boundary module; never expose the cast helper far from the validation that justifies it.

## Generics Model Caller-Dependent Types

If a value's type depends on what the caller supplies, make it generic rather than flattening to `any` or `unknown` and hand-casting at call sites.

```typescript
// Bad: caller must cast the result
export function getCached(key: string): unknown {
  return cache.get(key)
}

// Good: the caller's type flows through
export function getCached<T>(key: string, parse: (raw: string) => T): T | undefined {
  const raw = cache.get(key)
  if (raw === undefined) return undefined
  return parse(raw)
}
```

Constrain generics so the contract is discoverable: prefer `T extends SomeShape` over free-floating `T` when a shape assumption exists.

## Options Objects over Positional Parameters

Functions with more than a couple of knobs should take a single options object. It makes call sites self-documenting and lets new knobs be added without positional churn.

```typescript
interface FetchOptions {
  timeoutMs?: number
  retries?: number
  signal?: AbortSignal
}

export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  // ...
}
```
