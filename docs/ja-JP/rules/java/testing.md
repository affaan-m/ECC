---
paths:
  - "**/*.java"
---
# Java テスト

> このファイルは [common/testing.md](../common/testing.md) を Java 固有のコンテンツで拡張します。

## テストフレームワーク

- **JUnit 5**（`@Test`、`@ParameterizedTest`、`@Nested`、`@DisplayName`）
- **AssertJ** — 流暢なアサーション（`assertThat(result).isEqualTo(expected)`）
- **Mockito** — 依存関係のモック
- **Testcontainers** — データベースやサービスを必要とする統合テスト

## テストの構成

```
src/test/java/com/example/app/
  service/           # サービス層のユニットテスト
  controller/        # Web 層 / API テスト
  repository/        # データアクセステスト
  integration/       # クロスレイヤー統合テスト
```

`src/main/java` のパッケージ構造を `src/test/java` にミラーリングする。

## ユニットテストパターン

```java
@ExtendWith(MockitoExtension.class)
class OrderServiceTest {

    @Mock
    private OrderRepository orderRepository;

    private OrderService orderService;

    @BeforeEach
    void setUp() {
        orderService = new OrderService(orderRepository);
    }

    @Test
    @DisplayName("findById returns order when exists")
    void findById_existingOrder_returnsOrder() {
        var order = new Order(1L, "Alice", BigDecimal.TEN);
        when(orderRepository.findById(1L)).thenReturn(Optional.of(order));

        var result = orderService.findById(1L);

        assertThat(result.customerName()).isEqualTo("Alice");
        verify(orderRepository).findById(1L);
    }

    @Test
    @DisplayName("findById throws when order not found")
    void findById_missingOrder_throws() {
        when(orderRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> orderService.findById(99L))
            .isInstanceOf(OrderNotFoundException.class)
            .hasMessageContaining("99");
    }
}
```

## パラメータ化テスト

```java
@ParameterizedTest
@CsvSource({
    "100.00, 10, 90.00",
    "50.00, 0, 50.00",
    "200.00, 25, 150.00"
})
@DisplayName("discount applied correctly")
void applyDiscount(BigDecimal price, int pct, BigDecimal expected) {
    assertThat(PricingUtils.discount(price, pct)).isEqualByComparingTo(expected);
}
```

## 統合テスト

Testcontainers を使用した実データベース統合:

```java
@Testcontainers
class OrderRepositoryIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    private OrderRepository repository;

    @BeforeEach
    void setUp() {
        var dataSource = new PGSimpleDataSource();
        dataSource.setUrl(postgres.getJdbcUrl());
        dataSource.setUser(postgres.getUsername());
        dataSource.setPassword(postgres.getPassword());
        repository = new JdbcOrderRepository(dataSource);
    }

    @Test
    void save_and_findById() {
        var saved = repository.save(new Order(null, "Bob", BigDecimal.ONE));
        var found = repository.findById(saved.getId());
        assertThat(found).isPresent();
    }
}
```

Spring Boot 統合テストについては、スキル: `springboot-tdd` を参照してください。
Quarkus 統合テストについては、スキル: `quarkus-tdd` を参照してください。

## テスト命名

`@DisplayName` を使った説明的な名前:
- メソッド名には `methodName_scenario_expectedBehavior()`
- レポート用に `@DisplayName("人間が読める説明")`

## カバレッジ

- 行カバレッジ 80% 以上を目標
- カバレッジレポートには JaCoCo を使用
- サービスとドメインロジックに集中する — 自明な getter/設定クラスはスキップ

## リファレンス

スキル: `springboot-tdd` で MockMvc と Testcontainers を使った Spring Boot TDD パターンを参照してください。
スキル: `quarkus-tdd` で REST Assured と Dev Services を使った Quarkus TDD パターンを参照してください。
スキル: `java-coding-standards` でテスト要件を参照してください。
