---
name: rules-fsharp
description: ECC fsharp engineering rules for coding style, patterns, security, and testing.
display_name: "ECC Fsharp Rules"
icon: book
---

# ECC Fsharp Rules

## F# Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with F#-specific content.

### Standards

- Follow standard F# conventions and leverage the type system for correctness
- Prefer immutability by default; use `mutable` only when justified by performance
- Keep modules focused and cohesive

### Types and Models

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

### Immutability

- Records are immutable by default; use `with` expressions for updates
- Prefer `list`, `map`, `set` over mutable collections
- Avoid `ref` cells and mutable fields in domain logic

```fsharp
let rename (profile: UserProfile) newName =
    { profile with Name = newName }
```

### Function Style

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

### Async and Error Handling

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

### Formatting

- Use `fantomas` for automatic formatting
- Prefer significant whitespace; avoid unnecessary parentheses
- Remove unused `open` declarations

#### Open Declaration Order

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

## F# Hooks

> This file extends [common/hooks.md](../common/hooks.md) with F#-specific content.

### PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **fantomas**: Auto-format edited F# files
- **dotnet build**: Verify the solution or project still compiles after edits
- **dotnet test --no-build**: Re-run the nearest relevant test project after behavior changes

### Stop Hooks

- Run a final `dotnet build` before ending a session with broad F# changes
- Warn on modified `appsettings*.json` files so secrets do not get committed

## F# Patterns

> This file extends [common/patterns.md](../common/patterns.md) with F#-specific content.

### Result Type for Error Handling

Use `Result<'T, 'TError>` with railway-oriented programming instead of exceptions for expected failures.

```fsharp
type OrderError =
    | InvalidCustomer of string
    | EmptyItems
    | ItemOutOfStock of sku: string

let validateOrder (request: CreateOrderRequest) : Result<ValidatedOrder, OrderError> =
    if String.IsNullOrWhiteSpace request.CustomerId then
        Error(InvalidCustomer "CustomerId is required")
    elif request.Items |> List.isEmpty then
        Error EmptyItems
    else
        Ok { CustomerId = request.CustomerId; Items = request.Items }
```

### Option for Missing Values

Prefer `Option<'T>` over null. Use `Option.map`, `Option.bind`, and `Option.defaultValue` to transform.

```fsharp
let findUser (id: Guid) : User option =
    users |> Map.tryFind id

let getUserEmail userId =
    findUser userId
    |> Option.map (fun u -> u.Email)
    |> Option.defaultValue "unknown@example.com"
```

### Discriminated Unions for Domain Modeling

Model business states explicitly. The compiler enforces exhaustive handling.

```fsharp
type PaymentState =
    | AwaitingPayment of amount: decimal
    | Paid of paidAt: DateTimeOffset * transactionId: string
    | Refunded of refundedAt: DateTimeOffset * reason: string
    | Failed of error: string

let describePayment = function
    | AwaitingPayment amount -> $"Awaiting payment of {amount:C}"
    | Paid (at, txn) -> $"Paid at {at} (txn: {txn})"
    | Refunded (at, reason) -> $"Refunded at {at}: {reason}"
    | Failed error -> $"Payment failed: {error}"
```

### Computation Expressions

Use computation expressions to simplify sequential operations that may fail.

```fsharp
let placeOrder request =
    result {
        let! validated = validateOrder request
        let! inventory = checkInventory validated.Items
        let! order = createOrder validated inventory
        return order
    }
```

### Module Organization

- Group related functions in modules rather than classes
- Use `[<RequireQualifiedAccess>]` to prevent name collisions
- Keep modules small and focused on a single responsibility

```fsharp
[<RequireQualifiedAccess>]
module Order =
    let create customerId items = { Id = Guid.NewGuid(); CustomerId = customerId; Items = items; Status = Pending }
    let confirm order = { order with Status = Confirmed(DateTimeOffset.UtcNow) }
    let cancel reason order = { order with Status = Cancelled reason }
```

### Dependency Injection

- Define dependencies as function parameters or record-of-functions
- Use interfaces sparingly, primarily at the boundary with .NET libraries
- Prefer partial application for injecting dependencies into pipelines

```fsharp
type OrderDeps =
    { FindOrder: Guid -> Task<Order option>
      SaveOrder: Order -> Task<unit>
      SendNotification: Order -> Task<unit> }

let processOrder (deps: OrderDeps) orderId =
    task {
        match! deps.FindOrder orderId with
        | None -> return Error "Order not found"
        | Some order ->
            let confirmed = Order.confirm order
            do! deps.SaveOrder confirmed
            do! deps.SendNotification confirmed
            return Ok confirmed
    }
```

## F# Security

> This file extends [common/security.md](../common/security.md) with F#-specific content.

### Secret Management

- Never hardcode API keys, tokens, or connection strings in source code
- Use environment variables, user secrets for local development, and a secret manager in production
- Keep `appsettings.*.json` free of real credentials

```fsharp
// BAD
let apiKey = "sk-live-123"

// GOOD
let apiKey =
    configuration["OpenAI:ApiKey"]
    |> Option.ofObj
    |> Option.defaultWith (fun () -> failwith "OpenAI:ApiKey is not configured.")
```

### SQL Injection Prevention

- Always use parameterized queries with ADO.NET, Dapper, or EF Core
- Never concatenate user input into SQL strings
- Validate sort fields and filter operators before using dynamic query composition

```fsharp
let findByCustomer (connection: IDbConnection) customerId =
    task {
        let sql = "SELECT * FROM Orders WHERE CustomerId = @customerId"
        return! connection.QueryAsync<Order>(sql, {| customerId = customerId |})
    }
```

### Input Validation

- Validate inputs at the application boundary using types
- Use single-case discriminated unions for validated values
- Reject invalid input before it enters domain logic

```fsharp
type ValidatedEmail = private ValidatedEmail of string

module ValidatedEmail =
    let create (input: string) =
        if System.Text.RegularExpressions.Regex.IsMatch(input, @"^[^@]+@[^@]+\.[^@]+$") then
            Ok(ValidatedEmail input)
        else
            Error "Invalid email address"

    let value (ValidatedEmail v) = v
```

### Authentication and Authorization

- Prefer framework auth handlers instead of custom token parsing
- Enforce authorization policies at endpoint or handler boundaries
- Never log raw tokens, passwords, or PII

### Error Handling

- Return safe client-facing messages
- Log detailed exceptions with structured context server-side
- Do not expose stack traces, SQL text, or filesystem paths in API responses

### References

See skill: `security-review` for broader application security review checklists.

## F# Testing

> This file extends [common/testing.md](../common/testing.md) with F#-specific content.

### Test Framework

- Prefer **xUnit** with **FsUnit.xUnit** for F#-friendly assertions
- Use **Unquote** for quotation-based assertions with clear failure messages
- Use **FsCheck.xUnit** for property-based testing
- Use **NSubstitute** or function stubs for mocking dependencies
- Use **Testcontainers** when integration tests need real infrastructure

### Test Organization

- Mirror `src/` structure under `tests/`
- Separate unit, integration, and end-to-end coverage clearly
- Name tests by behavior, not implementation details

```fsharp
open Xunit
open Swensen.Unquote

[<Fact>]
let ``PlaceOrder returns success when request is valid`` () =
    let request = { CustomerId = "cust-123"; Items = [ validItem ] }
    let result = OrderService.placeOrder request
    test <@ Result.isOk result @>

[<Fact>]
let ``PlaceOrder returns error when items are empty`` () =
    let request = { CustomerId = "cust-123"; Items = [] }
    let result = OrderService.placeOrder request
    test <@ Result.isError result @>
```

### Property-Based Testing with FsCheck

```fsharp
open FsCheck.Xunit

[<Property>]
let ``order total is never negative`` (items: OrderItem list) =
    let total = Order.calculateTotal items
    total >= 0m
```

### ASP.NET Core Integration Tests

- Use `WebApplicationFactory<TEntryPoint>` for API integration coverage
- Test auth, validation, and serialization through HTTP, not by bypassing middleware

### Coverage

- Target 80%+ line coverage
- Focus coverage on domain logic, validation, auth, and failure paths
- Run `dotnet test` in CI with coverage collection enabled where available
