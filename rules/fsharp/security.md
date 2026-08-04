---
paths:
  - "**/*.fs"
  - "**/*.fsx"
  - "**/*.fsproj"
  - "**/appsettings*.json"
---
# F# Security

> This file extends [common/security.md](../common/security.md) with F#-specific content.

## Secret Management

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

## SQL Injection Prevention

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

## Input Validation

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

## Authentication and Authorization

- Prefer framework auth handlers instead of custom token parsing
- Enforce authorization policies at endpoint or handler boundaries
- Never log raw tokens, passwords, or PII

## Error Handling

- Return safe client-facing messages
- Log detailed exceptions with structured context server-side
- Do not expose stack traces, SQL text, or filesystem paths in API responses

## References

See skill: `security-review` for broader application security review checklists.
