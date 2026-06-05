# tinystruct Testing Patterns

## When to Use

Use these patterns when writing unit tests for your applications with **JUnit 5**. Essential for verifying action logic, routing registration, and HTTP mode behavior.

## How It Works

### Unit Testing Applications
ActionRegistry is a singleton. To test an application:
1. Instantiate the application.
2. Provide a `Settings` object (triggers `init()` and annotation processing).
3. Use `app.invoke(path, args)` to test logic directly.

### HTTP Integration Testing
For tests involving the built-in HTTP server:
1. Start `HttpServer` in a background thread.
2. Use `ApplicationManager.call("start", context, Action.Mode.CLI)` to boot.
3. Wait for the port to be open using a `Socket`.
4. Use `URLRequest` and `HTTPHandler` to perform actual requests.

## Examples

### Unit Test
```java
import org.junit.jupiter.api.*;
import org.tinystruct.system.Settings;

class MyAppTest {
    private MyApp app;

    @BeforeEach
    void setUp() {
        app = new MyApp();
        app.setConfiguration(new Settings());
        app.init(); // triggers @Action annotation processing and registers all actions
    }

    @Test
    void testHello() throws Exception {
        Object result = app.invoke("hello");
        Assertions.assertEquals("Hello!", result);
    }

    @Test
    void testGreet() throws Exception {
        Object result = app.invoke("greet", new Object[]{"James"});
        Assertions.assertEquals("Hello, James!", result);
    }
}
```

### ActionRegistry Match Testing
```java
@Test
void testRouting() {
    ActionRegistry registry = ActionRegistry.getInstance();
    Action action = registry.getAction("greet/James");
    Assertions.assertNotNull(action);
}
```

### HTTP Integration Pattern
Reference: `src/test/java/org/tinystruct/system/HttpServerHttpModeTest.java`

```java
// Pattern:
// 1. Start server in thread
// 2. Poll for port availability
// 3. Send HTTP request via HTTPHandler
// 4. Assert response body/status
```
