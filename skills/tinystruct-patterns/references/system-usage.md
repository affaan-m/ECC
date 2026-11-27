# tinystruct System and Usage Reference

## When to Use

Use these patterns to handle request state, manage web sessions, implement Server-Sent Events (SSE), handle file uploads, or perform outbound HTTP networking.

## How It Works

### Context and CLI Arguments
`Context` is the primary data store for request-specific state. CLI flags passed as `--key value` are stored in `Context` as `"--key"`.

### Session Management
Pluggable architecture. Default is `MemorySessionRepository`. Configure Redis in `application.properties`:
```properties
default.session.repository=org.tinystruct.http.RedisSessionRepository
redis.host=127.0.0.1
redis.port=6379
```

### Server-Sent Events (SSE)
Built-in support for real-time push. The `HttpServer` automatically handles the SSE lifecycle when it detects the `Accept: text/event-stream` header. Connections are tracked by session ID in `SSEPushManager`.

### Outbound Networking
Use `URLRequest` and `HTTPHandler` for making HTTP requests to external services.

## Examples

### Context and CLI Arguments
```java
@Action("echo")
public String echo() {
    // CLI: bin/dispatcher echo --words "Hello World"
    Object words = getContext().getAttribute("--words");
    if (words != null) return words.toString();
    return "No words provided";
}
```

### Session Management
```java
@Action(value = "login", mode = Mode.HTTP_POST)
public String login(Request<?, ?> request) {
    request.getSession().setAttribute("userId", "42");
    return "Logged in";
}
```

### Server-Sent Events (SSE)
```java
@Action("sse/connect")
public String connect() {
    return "{\"type\":\"connect\",\"message\":\"Connected\"}";
}

// In another method or event handler:
String sessionId = getContext().getId();
SSEPushManager.getInstance().push(sessionId, new Builder().put("msg", "hello"));
```

### File Uploads
```java
import org.tinystruct.data.FileEntity;

@Action(value = "upload", mode = Mode.HTTP_POST)
public String upload(Request<?, ?> request) throws ApplicationException {
    List<FileEntity> files = request.getAttachments();
    if (files != null) {
        for (FileEntity file : files) {
            // file.getFilename(), file.getContent()
        }
    }
    return "Uploaded";
}
```

### Outbound HTTP
```java
import org.tinystruct.net.URLRequest;
import org.tinystruct.net.handlers.HTTPHandler;

URLRequest request = new URLRequest(new URL("https://api.example.com"));
request.setMethod("POST").setBody("{\"data\":\"val\"}");

HTTPHandler handler = new HTTPHandler();
var response = handler.handleRequest(request);
if (response.getStatusCode() == 200) {
    String body = response.getBody();
}
```

### Event System
Register handlers in `init()` for asynchronous task execution.
```java
EventDispatcher.getInstance().registerHandler(MyEvent.class, event -> {
    CompletableFuture.runAsync(() -> doHeavyWork(event.getPayload()));
});
```
