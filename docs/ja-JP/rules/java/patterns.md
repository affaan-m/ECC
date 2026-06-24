---
paths:
  - "**/*.java"
---
# Java パターン

> このファイルは [common/patterns.md](../common/patterns.md) を Java 固有のコンテンツで拡張します。

## リポジトリパターン

データアクセスをインターフェースの背後にカプセル化する:

```java
public interface OrderRepository {
    Optional<Order> findById(Long id);
    List<Order> findAll();
    Order save(Order order);
    void deleteById(Long id);
}
```

具象実装がストレージの詳細を処理する（JPA、JDBC、テスト用インメモリ）。

## サービス層

ビジネスロジックはサービスクラスに配置する; コントローラとリポジトリは薄く保つ:

```java
public class OrderService {
    private final OrderRepository orderRepository;
    private final PaymentGateway paymentGateway;

    public OrderService(OrderRepository orderRepository, PaymentGateway paymentGateway) {
        this.orderRepository = orderRepository;
        this.paymentGateway = paymentGateway;
    }

    public OrderSummary placeOrder(CreateOrderRequest request) {
        var order = Order.from(request);
        paymentGateway.charge(order.total());
        var saved = orderRepository.save(order);
        return OrderSummary.from(saved);
    }
}
```

## コンストラクタインジェクション

常にコンストラクタインジェクションを使用する — フィールドインジェクションは使用しない:

```java
// GOOD — コンストラクタインジェクション（テスト可能、不変）
public class NotificationService {
    private final EmailSender emailSender;

    public NotificationService(EmailSender emailSender) {
        this.emailSender = emailSender;
    }
}

// BAD — フィールドインジェクション（リフレクションなしではテスト不可、フレームワークの魔法が必要）
public class NotificationService {
    @Inject // or @Autowired
    private EmailSender emailSender;
}
```

## DTO マッピング

DTO にはレコードを使用する。サービス/コントローラの境界でマッピングする:

```java
public record OrderResponse(Long id, String customer, BigDecimal total) {
    public static OrderResponse from(Order order) {
        return new OrderResponse(order.getId(), order.getCustomerName(), order.getTotal());
    }
}
```

## Builder パターン

オプションパラメータが多いオブジェクトに使用する:

```java
public class SearchCriteria {
    private final String query;
    private final int page;
    private final int size;
    private final String sortBy;

    private SearchCriteria(Builder builder) {
        this.query = builder.query;
        this.page = builder.page;
        this.size = builder.size;
        this.sortBy = builder.sortBy;
    }

    public static class Builder {
        private String query = "";
        private int page = 0;
        private int size = 20;
        private String sortBy = "id";

        public Builder query(String query) { this.query = query; return this; }
        public Builder page(int page) { this.page = page; return this; }
        public Builder size(int size) { this.size = size; return this; }
        public Builder sortBy(String sortBy) { this.sortBy = sortBy; return this; }
        public SearchCriteria build() { return new SearchCriteria(this); }
    }
}
```

## ドメインモデルのシールド型

```java
public sealed interface PaymentResult permits PaymentSuccess, PaymentFailure {
    record PaymentSuccess(String transactionId, BigDecimal amount) implements PaymentResult {}
    record PaymentFailure(String errorCode, String message) implements PaymentResult {}
}

// 網羅的な処理（Java 21+）
String message = switch (result) {
    case PaymentSuccess s -> "Paid: " + s.transactionId();
    case PaymentFailure f -> "Failed: " + f.errorCode();
};
```

## API レスポンスエンベロープ

一貫した API レスポンス:

```java
public record ApiResponse<T>(boolean success, T data, String error) {
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, data, null);
    }
    public static <T> ApiResponse<T> error(String message) {
        return new ApiResponse<>(false, null, message);
    }
}
```

## リファレンス

スキル: `springboot-patterns` で Spring Boot アーキテクチャパターンを参照してください。
スキル: `quarkus-patterns` で REST、Panache、メッセージングを含む Quarkus アーキテクチャパターンを参照してください。
スキル: `jpa-patterns` でエンティティ設計とクエリ最適化を参照してください。
