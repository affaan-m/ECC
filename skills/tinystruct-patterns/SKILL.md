---
name: tinystruct-patterns
description: Expert guidance for developing with the tinystruct Java framework. Use when working on the tinystruct codebase or any project built on tinystruct — including generating the bin/dispatcher and bin/dispatcher.cmd launcher scripts when a project lacks them, creating Application classes, @Action-mapped routes, unit tests, ActionRegistry, HTTP/CLI dual-mode handling, the built-in HTTP server, the event system, JSON with Builder/Builders, database persistence with AbstractData, POJO generation, Server-Sent Events (SSE), file uploads, and outbound HTTP networking.
origin: ECC
---

# tinystruct Development Patterns

Architecture and implementation patterns for building modules with the **tinystruct** Java framework – a lightweight, high-performance framework that treats CLI and HTTP as equal citizens, requiring no `main()` method and minimal configuration.

## Core Principle

**CLI and HTTP are equal citizens.** Every method annotated with `@Action` should ideally be runnable from both a terminal and a web browser without modification. This "dual-mode" capability is the core design philosophy of tinystruct.

## Primary Development Tool: `bin/dispatcher`

**`bin/dispatcher` is the default, highest-priority tool for developing, running, testing, and debugging a tinystruct application — reach for it before an IDE run configuration, a hand-written `main()`, curl, or a browser.** Because every `@Action` is dual-mode by design, `bin/dispatcher` lets you exercise routing, argument binding, and business logic directly from the terminal, with the fastest possible feedback loop and no server/browser required.

```bash
# Run any @Action directly - the fastest way to verify a new action works
# (the class must be imported; see --import or default.import.applications in application.properties)
bin/dispatcher greet/James --import com.example.MyService
bin/dispatcher echo --words "Praise the Lord"

# Start the HTTP server when you need the web-facing counterpart
bin/dispatcher start --import org.tinystruct.system.HttpServer

# Import additional Application/MCP classes for the current run
# (one --import per class; a comma-separated list fails with ClassNotFoundException)
bin/dispatcher start --import org.tinystruct.system.HttpServer --import com.example.MyService

# Discover what's available
bin/dispatcher --help
bin/dispatcher --version
```

Default to this workflow: implement the `@Action`, run it immediately via `bin/dispatcher <action>` to confirm it behaves correctly in CLI mode, and only start the HTTP server (also via `bin/dispatcher start ...`) once you need to verify the web-facing path (e.g. `mode = Mode.HTTP_POST`, sessions, file uploads). Never hardcode a `main(String[] args)` as an app's entry point — `bin/dispatcher` (or `bin/dispatcher.cmd` on Windows) is the one entry point for every module.

### Generating `bin/dispatcher` and `bin/dispatcher.cmd`

Every tinystruct project needs its launcher in `bin/`. **The framework generates it — never write it by hand, and never copy it from another project or substitute a `main()`.** `ApplicationManager.init()` writes the launcher for the current operating system into `bin/` under the working directory whenever it is missing, from templates inside the tinystruct jar, with that jar's version filled in. Line endings and the executable bit are already right.

**1. Find the tinystruct version** the project builds against: the `<tinystruct.version>` property or the `org.tinystruct:tinystruct` dependency in `pom.xml`. The jar must be reachable, in `~/.m2/repository/org/tinystruct/tinystruct/<version>/` (run `mvn dependency:resolve` if it is not) or in the project's `lib/`.

**2. From the project root, run the framework once:**

```bash
java -cp ~/.m2/repository/org/tinystruct/tinystruct/<version>/tinystruct-<version>.jar \
     org.tinystruct.system.Dispatcher --version
```

Replace `<version>` with the version found in step 1. On Windows use `%USERPROFILE%\.m2\repository\org\tinystruct\tinystruct\<version>\tinystruct-<version>.jar` and the same class. This creates **only the script for the OS you ran it on**, and only if it is not already there:

| Run on | Creates |
|---|---|
| Linux, macOS | `bin/dispatcher` (executable, LF) |
| Windows | `bin\dispatcher.cmd` (CRLF) |

**3. Verify.** From the project root run `bin/dispatcher --version` (Windows: `bin\dispatcher.cmd --version`). It prints `Dispatcher (cli) (built on tinystruct-<version>)`, and the `VERSION` inside the script equals the jar's version. Then `bin/dispatcher --help` lists the commands and every imported action. Show the user the file you created.

**4. Get both scripts by running step 2 on each OS**, or let a teammate or CI on the other OS run it and commit the result. Commit both, so a checkout on either OS works. Do not try to fake the other OS with `-Dos.name=…`: on Windows it fails (`UnsupportedOperationException` from `setPosixFilePermissions`) and leaves an empty `bin/dispatcher`. Recommended `.gitattributes`, so a checkout does not corrupt the line endings:

```
bin/dispatcher     text eol=lf
bin/dispatcher.cmd text eol=crlf
```

**Upgrading tinystruct:** change the version in `pom.xml`, delete the old script, and repeat step 2 with the new jar. Alternatively `bin/dispatcher update` checks Maven Central for the latest release, upgrades the project's dependency and regenerates the script with force; it needs the network, edits the `pom.xml`, and goes to the *latest* version, not a chosen one.

**It also happens implicitly.** Any code that reaches `ApplicationManager.init()` (the dispatcher itself, or `ApplicationManager.install(app, config)` in a unit test) creates the script in the *current directory* if it is missing. If unit tests scatter `bin/dispatcher.cmd` into module directories, run them from the build directory: in the surefire configuration set `<workingDirectory>${project.build.directory}</workingDirectory>`.

**What the scripts do**, which explains most problems:

- Run them **from the project root**: the shell script takes the current directory as the root, the `.cmd` takes the parent of `bin/`.
- The classpath is `target/classes`, `lib/*.jar`, `WEB-INF/lib/*`, `WEB-INF/classes` and the tinystruct jar (from `lib/`, else `~/.m2`), then they run `org.tinystruct.system.Dispatcher` with your arguments.
- On the first run, if `mvnw` / `mvnw.cmd` is missing, they extract the Maven Wrapper into the project root (`unzip` on Unix, PowerShell on Windows). Tell the user this happens; the files can be committed or ignored.
- Only the shell script treats `-D…` and `-X…` arguments as JVM options.

**Gotchas:**

- **On Windows use `bin\dispatcher.cmd`.** The shell script joins the classpath with `:`, so under Git Bash/MSYS it fails with `ClassNotFoundException: org.tinystruct.system.Dispatcher`. Use WSL, or the `.cmd`.
- **Only the tinystruct jar is on the classpath.** The framework no longer ships a fat jar by default, so your other modules, JDBC drivers and libraries (jjwt, lettuce, …) must be in `lib/`: `mvn dependency:copy-dependencies -DoutputDirectory=lib` (and git-ignore `lib/`). In a multi-module build, keep the launcher in the directory that holds `target/classes` and `lib/`, and copy the sibling modules' jars into that `lib/`; running it from a module whose siblings are not on its classpath fails with `NoClassDefFoundError`.
- **Load applications with `--import` or configuration.** One `--import` per class (`--import a.A,b.B` fails; write `--import a.A --import b.B`), or list them once in `application.properties`: `default.import.applications=a.A;b.B` (`;`-separated).
- **`JAVA_HOME` must be set** for the `.cmd`; it stops with an error otherwise.
- **`bin/` sits directly under the directory that holds `target/classes` and `lib/`.** The `.cmd` treats the parent of `bin/` as the root, so a `bin/` nested in the wrong directory puts the wrong classpath in front of `Dispatcher`.

## When to Activate

### When to Use

- Running, testing, or debugging any `@Action` via `bin/dispatcher` — this is the default way to work with a tinystruct app, before reaching for HTTP or an IDE run configuration.
- Setting up a project that has no `bin/dispatcher` / `bin/dispatcher.cmd` — have the framework generate it (see "Generating `bin/dispatcher` and `bin/dispatcher.cmd`").
- Creating new `Application` modules by extending `AbstractApplication`.
- Defining routes and command-line actions using `@Action`.
- Handling per-request state via `Context`.
- Performing JSON serialization using the native `Builder` and `Builders` components.
- Working with database persistence via `AbstractData` POJOs.
- Generating POJOs from database tables using the `generate` command, with an XML mapping file or annotations (`--mapping annotation`).
- Implementing Server-Sent Events (SSE) for real-time push.
- Handling file uploads via multipart data.
- Making outbound HTTP requests with `URLRequest` and `HTTPHandler`.
- Configuring database connections or system settings in `application.properties`.
- Debugging routing conflicts (Actions) or CLI argument parsing.

## How It Works

The tinystruct framework treats any method annotated with `@Action` as a routable endpoint for both terminal and web environments. Applications are created by extending `AbstractApplication`, which provides core lifecycle hooks like `init()` and access to the request `Context`.

Routing is handled by the `ActionRegistry`, which automatically maps path segments to method arguments and injects dependencies. For data-only services, the native `Builder` and `Builders` components should be used for JSON serialization to maintain a zero-dependency footprint. The database layer uses `AbstractData` POJOs mapped to tables with `@Table`/`@Column` annotations or XML mapping files for CRUD operations without external ORM libraries. Missing tables can be created automatically with `database.autocreate=true`.

## Examples

### Basic Application (MyService)
```java
public class MyService extends AbstractApplication {
    @Override
    public void init() {
        this.setTemplateRequired(false); // Disable .view lookup for data/API apps
    }

    @Override public String version() { return "1.0.0"; }

    @Action("greet")
    public String greet() {
        return "Hello from tinystruct!";
    }

    // Path parameter: GET /?q=greet/James  OR  bin/dispatcher greet/James
    @Action("greet")
    public String greet(String name) {
        return "Hello, " + name + "!";
    }
}
```

### HTTP Mode Disambiguation (login)
```java
@Action(value = "login", mode = Mode.HTTP_POST)
public String doLogin(Request<?, ?> request) throws ApplicationException {
    request.getSession().setAttribute("userId", "42");
    return "Logged in";
}
```

### Native JSON Data Handling (Builder + Builders)
```java
import org.tinystruct.data.component.Builder;
import org.tinystruct.data.component.Builders;

@Action("api/data")
public String getData() throws ApplicationException {
    Builders dataList = new Builders();
    Builder item = new Builder();
    item.put("id", 1);
    item.put("name", "James");
    dataList.add(item);

    Builder response = new Builder();
    response.put("status", "success");
    response.put("data", dataList);
    return response.toString(); // {"status":"success","data":[{"id":1,"name":"James"}]}
}
```

### SSE (Server-Sent Events)
```java
import org.tinystruct.http.SSEPushManager;

@Action("sse/connect")
public String connect() {
    return "{\"type\":\"connect\",\"message\":\"Connected to SSE\"}";
}

// Push to a specific client
String sessionId = getContext().getId();
Builder msg = new Builder();
msg.put("text", "Hello, user!");
SSEPushManager.getInstance().push(sessionId, msg);

// Broadcast to all
// Broadcast to all
SSEPushManager.getInstance().broadcast(msg);
```

### File Upload
```java
import org.tinystruct.data.FileEntity;

@Action(value = "upload", mode = Mode.HTTP_POST)
public String upload(Request<?, ?> request) throws ApplicationException {
    List<FileEntity> files = request.getAttachments();
    if (files != null) {
        for (FileEntity file : files) {
            System.out.println("Uploaded: " + file.getFilename());
        }
    }
    return "Upload OK";
}
```

### Database Metadata Operations
`DatabaseOperator` provides direct access to connection-level catalog, schema, and metadata:
```java
import org.tinystruct.data.DatabaseOperator;

DatabaseOperator operator = new DatabaseOperator();
try {
    String catalog = operator.getCatalog();
    String schema = operator.getSchema();
    java.sql.DatabaseMetaData metaData = operator.getMetaData();
    System.out.println("Using catalog: " + catalog + ", schema: " + schema);
} finally {
    operator.close();
}
```

## MCP Server and Tools Integration

tinystruct provides native support for the Model Context Protocol (MCP) starting with SDK version **`1.7.0`**.
The MCP APIs (e.g., `org.tinystruct.mcp.MCPTool`, `org.tinystruct.mcp.MCPServer`, `org.tinystruct.mcp.MCPException`) are included directly in the core dependency:
```xml
<dependency>
    <groupId>org.tinystruct</groupId>
    <artifactId>tinystruct</artifactId>
    <version>1.7.34</version>
</dependency>
```

> **SECURITY WARNING (Prompt Injection):**
> Tool return values are fed directly back into the AI model's context window. You **MUST** validate and sanitize all caller-supplied arguments before including them in the tool's return string. Failure to sanitize inputs can allow an attacker to inject adversarial instructions (Prompt Injection) that override the model's behavior. Always validate length, character sets, and nullity.

**To create an MCP Tool:**
1. Extend `org.tinystruct.mcp.MCPTool`.
2. Annotate operations with `@Action` and declare parameters using `@Argument` within the `arguments` array.
3. Accept parameters as explicit method arguments matching the keys in `@Argument`. (Do **not** use `getContext().getAttribute(...)` for tool arguments).

```java
import org.tinystruct.mcp.MCPTool;
import org.tinystruct.mcp.MCPException;
import org.tinystruct.system.annotation.Action;
import org.tinystruct.system.annotation.Argument;

public class MyCustomTool extends MCPTool {
    public MyCustomTool() {
        super("custom", "A custom tool for demonstrating MCP");
    }

    @Action(
        value = "custom/hello",
        description = "Say hello to someone",
        arguments = {
            @Argument(key = "name", description = "The name to greet", type = "string", optional = false)
        }
    )
    public String hello(String name) throws MCPException {
        // SECURITY: Validate/sanitize tool inputs before returning to the model
        // to prevent prompt injection vulnerabilities.
        if (name == null || name.length() > 50 || !name.matches("^[a-zA-Z0-9 ]+$")) {
            throw new MCPException("Invalid name provided");
        }
        return "Hello, " + name + "!";
    }
}
```

**To deploy an MCP Server:**
1. Extend `org.tinystruct.mcp.MCPServer`.
2. Override `init()` and register your tools using `this.registerTool()`. The framework automatically scans and maps the `@Action` methods.

```java
import org.tinystruct.mcp.MCPServer;

public class MyMCPServer extends MCPServer {
    @Override
    public void init() {
        super.init();
        this.registerTool(new MyCustomTool());
    }

    @Override
    public String version() {
        return "1.0.0";
    }
}
```

Run the server via the dispatcher:
```bash
bin/dispatcher start --import org.tinystruct.system.HttpServer --import com.example.MyMCPServer
```

### Overloaded Tool Methods
tinystruct supports overloaded methods for the same tool name in `MCPTool` (sharing the same tool name but accepting different parameter signatures).
- **Schema Merging**: Input schemas of all overloads with the same name are dynamically merged into a unified JSON schema. Properties are unioned, and required properties are intersected (only fields required across *all* overloads remain marked mandatory).
- **Execution Routing**: When executing a tool, the server iterates sequentially through the available overloaded methods, attempting execution. Each method's schema validation is performed first, and the first overload that validates against the provided arguments successfully executes. If no signature matches or succeeds, the framework throws an appropriate exception.

## Configuration

Settings are managed in `src/main/resources/application.properties`.

```properties
# Database
driver=org.h2.Driver
database.url=jdbc:h2:~/mydb
database.user=sa
database.password=
# Optional: create missing tables from the class mapping on first use (off by default)
# database.autocreate=true

# Server
default.home.page=hello
server.port=8080
default.server.open_browser=true

# Locale
default.language=en_US

# Session (Redis for clustered environments)
# default.session.repository=org.tinystruct.http.RedisSessionRepository
# redis.host=127.0.0.1
# redis.port=6379

# Programmatic Logging Configuration
logging.enabled=true
logging.level=INFO
org.tinystruct.level=FINE
```

Access config values in your application:
```java
String port = this.getConfiguration("server.port");
```

## Logging and Diagnostics

The framework includes a programmatic wrapper around `java.util.logging` (JUL) that provides beautiful console output and advanced caller tracing out of the box.

- **ANSI Console Colors**: Console output is color-coded based on the log level (red for SEVERE, yellow for WARNING, green for INFO, cyan for CONFIG, and grey for FINE/debug logs).
- **Precise Caller Tracing**: Uses Java's `StackWalker` API to trace the call stack at runtime. It identifies and logs the exact class, method, filename, and line number of the caller that initiated the log (bypassing internal utility and logging layers).
- **Package/Logger Level Overrides**: Set package-specific overrides directly in `application.properties` (e.g., `org.tinystruct.level=FINE`).

## Red Flags & Anti-patterns

| Symptom | Correct Pattern |
|---|---|
| Importing `com.google.gson` or `com.fasterxml.jackson` | Use `org.tinystruct.data.component.Builder` / `Builders`. |
| Using `List<Builder>` for JSON arrays | Use `Builders` to avoid generic type erasure issues. |
| `ApplicationRuntimeException: template not found` | Call `setTemplateRequired(false)` in `init()` for API-only apps. |
| Annotating `private` methods with `@Action` | Actions must be `public` to be registered by the framework. |
| Hardcoding `main(String[] args)` in apps, or testing only via curl/browser/IDE run configs | Use `bin/dispatcher` as the entry point and default dev/test tool for all modules. |
| `bin/dispatcher` is missing, or a hand-written or copied launcher script | Let the framework generate it: run `org.tinystruct.system.Dispatcher --version` once from the project root (creates the current OS's script). |
| `bin/dispatcher` fails with `ClassNotFoundException: org.tinystruct.system.Dispatcher` on Windows | The shell script cannot run under Git Bash/MSYS; use `bin\dispatcher.cmd` or WSL. |
| `ClassNotFoundException` for `--import a.A,b.B` | One `--import` per class: `--import a.A --import b.B`. |
| A shell-script launcher that fails with `\r: command not found` | The file has CRLF endings; convert `bin/dispatcher` to LF. |
| Manual `ActionRegistry` registration | Prefer the `@Action` annotation for automatic discovery. |
| Action not found at runtime | Ensure class is imported via `--import` or listed in `application.properties`. |
| CLI arg not visible | Pass with `--key value`; access via `getContext().getAttribute("--key")`. |
| Two methods same path, wrong one fires | Set explicit `mode` (e.g., `HTTP_GET` vs `HTTP_POST`) to disambiguate. |

## Best Practices

1. **`bin/dispatcher` first**: Develop and verify against `bin/dispatcher` before anything else — run the action from the CLI, confirm behavior, then layer on HTTP/mode concerns. It's the fastest inner-loop and the one tool guaranteed to match how the framework actually routes and binds arguments.
2. **Granular Applications**: Break logic into smaller, focused applications rather than one monolithic class.
3. **Setup in `init()`**: Leverage `init()` for setup (config, DB) rather than the constructor. Do NOT call `setAction()` — use `@Action` annotation.
4. **Mode Awareness**: Use the `Mode` parameter in `@Action` to restrict sensitive operations to `CLI` only or specific HTTP methods.
5. **Context over Params**: For optional CLI flags, use `getContext().getAttribute("--flag")` rather than adding parameters to the method signature.
6. **Asynchronous Events**: For heavy tasks triggered by events, use `CompletableFuture.runAsync()` inside the event handler.

## Technical Reference

Detailed guides are available in the `references/` directory:

- [Architecture & Config](references/architecture.md) — Abstractions, Package Map, Properties
- [Routing & @Action](references/routing.md) — Annotation details, Modes, Parameters
- [Data Handling](references/data-handling.md) — Builder, Builders, JSON serialization & parsing
- [Database Persistence](references/database.md) — AbstractData POJOs, CRUD, annotation and XML mapping, POJO generation, table auto-creation
- [System & Usage](references/system-usage.md) — Context, Sessions, SSE, File Uploads, Events, Networking
- [Testing Patterns](references/testing.md) — JUnit 5 unit and HTTP integration testing

## Reference Source Files (Internal)

- `src/main/java/org/tinystruct/AbstractApplication.java` — Core base class with lifecycle hooks
- `src/main/java/org/tinystruct/system/annotation/Action.java` — Annotation & Modes
- `src/main/java/org/tinystruct/application/ActionRegistry.java` — Routing Engine
- `src/main/java/org/tinystruct/data/component/Builder.java` — JSON object serializer
- `src/main/java/org/tinystruct/data/component/Builders.java` — JSON array serializer
- `src/main/java/org/tinystruct/data/component/AbstractData.java` — Base POJO class with CRUD
- `src/main/java/org/tinystruct/data/Mapping.java` — Mapping metadata (annotations or XML), cached per class
- `src/main/java/org/tinystruct/data/annotation/Table.java` — `@Table`, with `@Id` and `@Column` alongside it
- `src/main/java/org/tinystruct/data/tools/TableCreator.java` — Creates missing tables (`database.autocreate`)
- `src/main/java/org/tinystruct/data/tools/MySQLGenerator.java` — POJO generator reference (`MappingMode` selects XML or annotations)
- `src/main/java/org/tinystruct/data/component/FieldType.java` — SQL-to-Java type mappings
- `src/main/java/org/tinystruct/data/component/Condition.java` — Fluent SQL query builder
- `src/main/java/org/tinystruct/http/SSEPushManager.java` — SSE connection management
- `src/main/java/org/tinystruct/system/logging/LogFormatter.java` — Custom log formatter with ANSI console colors and StackWalker-based caller tracing
- `src/main/java/org/tinystruct/system/logging/LoggerConfigurer.java` — Programmatic logging configurator from application properties
- `src/test/java/org/tinystruct/application/ActionRegistryTest.java` — Registry test examples
- `src/test/java/org/tinystruct/system/HttpServerHttpModeTest.java` — HTTP integration test patterns
