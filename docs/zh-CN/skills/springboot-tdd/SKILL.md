---
name: springboot-tdd
description: 使用JUnit 5、Mockito、MockMvc、Testcontainers和JaCoCo进行Spring Boot的测试驱动开发。适用于添加功能、修复错误或重构时。
origin: ECC
---

# Spring Boot TDD 工作流程

适用于 Spring Boot 服务、覆盖率 80%+（单元 + 集成）的 TDD 指南。

## 何时使用

* 新功能或端点
* 错误修复或重构
* 添加数据访问逻辑或安全规则

## 工作流程

1. 先写测试（它们应该失败）
2. 实现最小代码以通过测试
3. 在测试通过后进行重构
4. 强制覆盖率（JaCoCo）

## 单元测试 (JUnit 5 + Mockito)

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

模式：

* Arrange-Act-Assert
* 避免部分模拟；优先使用显式桩
* 使用 `@ParameterizedTest` 处理变体

## Web 层测试 (MockMvc)

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

## 集成测试 (SpringBootTest)

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

## 持久层测试 (DataJpaTest)

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

* 对 Postgres/Redis 使用可复用的容器以镜像生产环境
* 通过 `@DynamicPropertySource` 连接，将 JDBC URL 注入 Spring 上下文

## 覆盖率 (JaCoCo)

Maven 片段：

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
    <execution>
      <id>check</id>
      <phase>verify</phase>
      <goals><goal>check</goal></goals>
      <configuration>
        <rules>
          <rule>
            <element>BUNDLE</element>
            <limits>
              <limit>
                <counter>LINE</counter>
                <value>COVEREDRATIO</value>
                <minimum>0.80</minimum>
              </limit>
            </limits>
          </rule>
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

## 断言

* 为可读性，优先使用 AssertJ (`assertThat`)
* 对于 JSON 响应，使用 `jsonPath`
* 对于异常：`assertThatThrownBy(...)`

## 测试数据构建器

```java
class MarketBuilder {
  private String name = "Test";
  MarketBuilder withName(String name) { this.name = name; return this; }
  Market build() { return new Market(null, name, MarketStatus.ACTIVE); }
}
```

## CI 命令

* Maven：`mvn -T 4 test` 运行测试；`mvn verify` 还会生成报告并执行配置的 80% 行覆盖率门槛。
* Gradle：`./gradlew test jacocoTestReport` 运行测试并生成报告。要执行覆盖率门槛，请为 `jacocoTestCoverageVerification` (`counter = "LINE"`, `value = "COVEREDRATIO"`, `minimum = 0.80`) 配置 80% 规则，并运行该任务。

**记住**：保持测试快速、隔离且确定。测试行为，而非实现细节。
