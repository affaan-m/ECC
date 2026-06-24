# tinystruct @Action Routing Reference

## When to Use

Use the `@Action` annotation in your applications to define routes for both CLI commands and HTTP endpoints. It is appropriate whenever you need to map logic to a specific path, handle parameterized requests, or restrict execution to specific HTTP methods while maintaining a consistent command structure across environments.

## How It Works

The `ActionRegistry` parses `@Action` annotations to build a routing table. For parameterized methods, the framework automatically maps Java parameter types to corresponding regex segments.

### Regex Generation Rules
- `getUser(int id)` → pattern: `^/?user/(-?\d+)$`
- `search(String query)` → pattern: `^/?search/([^/]+)$`

Supported parameter types: `String`, `int/Integer`, `long/Long`, `float/Float`, `double/Double`, `boolean/Boolean`, `char/Character`, `short/Short`, `byte/Byte`, `Date` (parsed as `yyyy-MM-dd HH:mm:ss`).

### Mode Values

| Mode | When it triggers |
|---|---|
| `DEFAULT` | Both CLI and HTTP (GET, POST, etc.) |
| `CLI` | CLI dispatcher only |
| `HTTP_GET` | HTTP GET only |
| `HTTP_POST` | HTTP POST only |
| `HTTP_PUT` | HTTP PUT only |
| `HTTP_DELETE` | HTTP DELETE only |
| `HTTP_PATCH` | HTTP PATCH only |

> **Note:** You can map HTTP method names to `Mode` using `Action.Mode.fromName(String methodName)`. Unknown or null values return `Mode.DEFAULT`.

## Examples

### Basic Action Declaration
```java
@Action(
    value = "path/subpath",          // required: URI segment or CLI command
    description = "What it does",    // shown in --help output
    mode = Mode.DEFAULT,             // default: Mode.DEFAULT
    example = "bin/dispatcher path/subpath/42"
)
public String myAction(int id) { ... }
```

### Parameterized Paths
```java
@Action("user/{id}")
public String getUser(int id) { ... }
// → CLI: bin/dispatcher user/42
// → HTTP: /?q=user/42
```

### Dependency Injection
`ActionRegistry` automatically injects `Request` and/or `Response` from `Context` if they are parameters:

```java
@Action(value = "upload", mode = Mode.HTTP_POST)
public String upload(Request<?, ?> req, Response<?, ?> res) throws ApplicationException {
    // Access raw request/response if needed
    return "ok";
}
```

### Path Matching Priority
If two methods share the same path, the framework uses the first match in the `ActionRegistry`. Use explicit `Mode` values to disambiguate (e.g., separating a GET for a form and a POST for submission).
