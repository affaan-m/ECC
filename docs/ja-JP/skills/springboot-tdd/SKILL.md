---
name: springboot-tdd
description: Test-driven development for Spring Boot using JUnit 5, Mockito, MockMvc, Testcontainers, and JaCoCo. Use when adding features, fixing bugs, or refactoring.
---

# Spring Boot TDD ワークフロー

80%以上のカバレッジ（ユニット+統合）を持つSpring Bootサービスのためのテスト駆動開発ガイダンス。

## いつ使用するか

- 新機能やエンドポイント
- バグ修正やリファクタリング
- データアクセスロジックやセキュリティルールの追加

## ワークフロー

1) テストを最初に書く（失敗すべき）
2) テストを通すための最小限のコードを実装
3) テストをグリーンに保ちながらリファクタリング
4) カバレッジを強制（JaCoCo）

## ユニットテスト（JUnit 5 + Mockito）

```java
@ExtendWith(MockitoExtension.class)
class MarketServiceTest {
  @Mock MarketRepository repo;
  @InjectMocks MarketService service;

  @Test
  void createsMarket() {
    CreateMarketRequest req = new CreateMarketRequest("name", "desc", Instant.now(), List.of("cat"));
    when(repo.save(any())).thenAnswer(inv -> inv.getArgument(0));

    Market result = service.create(req);

    assertThat(result.name()).isEqualTo("name");
    verify(repo).save(any());
  }
}
```

パターン:
- Arrange-Act-Assert
- 部分モックを避ける。明示的なスタビングを優先
- バリエーションに`@ParameterizedTest`を使用

## Webレイヤーテスト（MockMvc）

```java
@WebMvcTest(MarketController.class)
class MarketControllerTest {
  @Autowired MockMvc mockMvc;
  @MockBean MarketService marketService;

  @Test
  void returnsMarkets() throws Exception {
    when(marketService.list(any())).thenReturn(Page.empty());

    mockMvc.perform(get("/api/markets"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content").isArray());
  }
}
```

## 統合テスト（SpringBootTest）

```java
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MarketIntegrationTest {
  @Autowired MockMvc mockMvc;

  @Test
  void createsMarket() throws Exception {
    mockMvc.perform(post("/api/markets")
        .contentType(MediaType.APPLICATION_JSON)
        .content("""
          {"name":"Test","description":"Desc","endDate":"2030-01-01T00:00:00Z","categories":["general"]}
        """))
      .andExpect(status().isCreated());
  }
}
```

## 永続化テスト（DataJpaTest）

```java
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(TestContainersConfig.class)
class MarketRepositoryTest {
  @Autowired MarketRepository repo;

  @Test
  void savesAndFinds() {
    MarketEntity entity = new MarketEntity();
    entity.setName("Test");
    repo.save(entity);

    Optional<MarketEntity> found = repo.findByName("Test");
    assertThat(found).isPresent();
  }
}
```

## Testcontainers

- 本番環境を反映するためにPostgres/Redis用の再利用可能なコンテナを使用
- `@DynamicPropertySource`経由でJDBC URLをSpringコンテキストに注入

## カバレッジ（JaCoCo）

Mavenスニペット:
```xml
<plugin>
  <groupId>org.jacoco</groupId>
  <artifactId>jacoco-maven-plugin</artifactId>
  <version>0.8.14</version>
  <executions>
    <execution>
      <goals><goal>prepare-agent</goal></goals>
    </execution>
    <execution>
      <id>report</id>
      <phase>verify</phase>
      <goals><goal>report</goal></goals>
    </execution>
  </executions>
</plugin>
```

## アサーション

- 可読性のためにAssertJ（`assertThat`）を優先
- JSONレスポンスには`jsonPath`を使用
- 例外には: `assertThatThrownBy(...)`

## テストデータビルダー

```java
class MarketBuilder {
  private String name = "Test";
  MarketBuilder withName(String name) { this.name = name; return this; }
  Market build() { return new Market(null, name, MarketStatus.ACTIVE); }
}
```

## CIコマンド

- Maven: `mvn -T 4 test` または `mvn verify`
- Gradle: `./gradlew test jacocoTestReport`

**覚えておいてください**: テストは高速で、分離され、決定論的に保ちます。実装の詳細ではなく、動作をテストします。
