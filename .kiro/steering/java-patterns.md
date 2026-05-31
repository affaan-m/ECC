---
inclusion: fileMatch
fileMatchPattern: "*.java"
description: Java-specific patterns, Spring Boot, and enterprise best practices.
---

# Java Patterns

> This file extends the common patterns with Java specific content.

## Immutability

- Prefer `record` for value types (Java 16+)
- Mark fields `final` by default — use mutable state only when required
- Return defensive copies: `List.copyOf()`, `Map.copyOf()`

```java
public record OrderSummary(Long id, String customerName, BigDecimal total) {}
```

## Modern Java Features

- **Records** for DTOs and value types (Java 16+)
- **Sealed classes** for closed type hierarchies (Java 17+)
- **Pattern matching** with `instanceof` (Java 16+)
- **Switch expressions** with arrow syntax (Java 14+)

```java
public sealed interface PaymentResult permits PaymentSuccess, PaymentFailure {}
record PaymentSuccess(String transactionId, BigDecimal amount) implements PaymentResult {}
record PaymentFailure(String errorCode, String message) implements PaymentResult {}
```

## Constructor Injection

Always use constructor injection — never field injection:

```java
// GOOD
public class NotificationService {
    private final EmailSender emailSender;
    public NotificationService(EmailSender emailSender) {
        this.emailSender = emailSender;
    }
}

// BAD — field injection
@Inject private EmailSender emailSender;
```

## Repository Pattern

```java
public interface OrderRepository {
    Optional<Order> findById(Long id);
    List<Order> findAll();
    Order save(Order order);
    void deleteById(Long id);
}
```

## Optional Usage

- Return `Optional<T>` from finder methods that may have no result
- Use `map()`, `flatMap()`, `orElseThrow()` — never call `get()` without `isPresent()`
- Never use `Optional` as a field type or method parameter

## Error Handling

- Prefer unchecked exceptions for domain errors
- Create domain-specific exceptions extending `RuntimeException`
- Never expose stack traces in API responses

```java
public class OrderNotFoundException extends RuntimeException {
    public OrderNotFoundException(Long id) {
        super("Order not found: id=" + id);
    }
}
```

## Security

- Never hardcode secrets — use `System.getenv("API_KEY")`
- Always use parameterized queries (`PreparedStatement`, JPA, JDBC template)
- Use Bean Validation (`@NotNull`, `@NotBlank`, `@Size`) on DTOs
- Store passwords with bcrypt or Argon2

## Testing

- JUnit 5 with AssertJ for fluent assertions
- Mockito for mocking dependencies
- Testcontainers for integration tests
- Target 80%+ coverage with JaCoCo

```java
@Test
@DisplayName("findById returns order when exists")
void findById_existingOrder_returnsOrder() {
    var order = new Order(1L, "Alice", BigDecimal.TEN);
    when(orderRepository.findById(1L)).thenReturn(Optional.of(order));
    var result = orderService.findById(1L);
    assertThat(result.customerName()).isEqualTo("Alice");
}
```

## Reference

See agents: `java-reviewer`, `java-build-resolver` for Java-specific review and build error resolution.
See skills: `springboot-patterns`, `jpa-patterns` for framework-specific guidance.
