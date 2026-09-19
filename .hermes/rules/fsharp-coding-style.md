---
paths:
  - "**/*.fs"
  - "**/*.fsx"
---
# F# Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with F#-specific content.

## Standards

- Follow standard F# conventions and leverage the type system for correctness
- Prefer immutability by default; use `mutable` only when justified by performance
- Keep modules focused and cohesive

## Types and Models

- Prefer discriminated unions for domain modeling over class hierarchies
- Use records for data with named fields
- Use single-case unions for type-safe wrappers around primitives
- Avoid classes unless interop or mutable state requires them

```fsharp
type EmailAddress = EmailAddress of string

type OrderStatus =
    | Pending
    | Confirmed of confirmedAt: DateTimeOffset
    | Shipped of trackingNumber: string
    | Cancelled of reason: string

type Order =
    { Id: Guid
      CustomerId: string
      Status: OrderStatus
      Items: OrderItem list }
```

## Immutability

- Records are immutable by default; use `with` expressions for updates
- Prefer `list`, `map`, `set` over mutable collections
- Avoid `ref` cells and mutable fields in domain logic

```fsharp
let rename (profile: UserProfile) newName =
    { profile with Name = newName }
```

## Function Style

- Prefer small, composable functions over large methods
- Use the pipe operator `|>` to build readable data pipelines
- Prefer pattern matching over if/else chains
- Use `Option` instead of null; use `Result` for operations that can fail

```fsharp
let processOrder order =
    order
    |> validateItems
    |> Result.bind calculateTotal
    |> Result.map applyDiscount
    |> Result.mapError OrderError
```

## Async and Error Handling

- Use `task { }` for interop with .NET async APIs
- Use `async { }` for F#-native async workflows
- Propagate `CancellationToken` through public async APIs
- Prefer `Result` and railway-oriented programming over exceptions for expected failures

```fsharp
let loadOrderAsync (orderId: Guid) (ct: CancellationToken) =
    task {
        let! order = repository.FindAsync(orderId, ct)
        return
            order
            |> Option.defaultWith (fun () ->
                failwith $"Order {orderId} was not found.")
    }
```

## Formatting

- Use `fantomas` for automatic formatting
- Prefer significant whitespace; avoid unnecessary parentheses
- Remove unused `open` declarations

### Open Declaration Order

Group `open` statements into four sections separated by a blank line, each section sorted lexically within itself:

1. `System.*`
2. `Microsoft.*`
3. Third-party namespaces
4. First-party / project namespaces

```fsharp
open System
open System.Collections.Generic
open System.Threading.Tasks

open Microsoft.AspNetCore.Http
open Microsoft.Extensions.Logging

open FsCheck.Xunit
open Swensen.Unquote

open MyApp.Domain
open MyApp.Infrastructure
```
