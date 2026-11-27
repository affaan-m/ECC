---
name: springboot-tdd
description: Test-driven development for Spring Boot using JUnit 5, Mockito, MockMvc, Testcontainers, and JaCoCo. Use when adding features, fixing bugs, or refactoring.
origin: ECC
---

# Spring Boot TDD İş Akışı

80%+ kapsam (unit + integration) ile Spring Boot servisleri için TDD rehberi.

## Ne Zaman Kullanılır

- Yeni özellikler veya endpoint'ler
- Bug düzeltmeleri veya refactoring'ler
- Veri erişim mantığı veya güvenlik kuralları ekleme

## İş Akışı

1) Önce testleri yazın (başarısız olmalılar)
2) Geçmek için minimal kod uygulayın
3) Testleri yeşil tutarken refactor edin
4) Kapsamı zorlayın (JaCoCo)

## Unit Testler (JUnit 5 + Mockito)

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

Desenler:
- Arrange-Act-Assert
- Kısmi mock'lardan kaçının; açık stubbing tercih edin
- Varyantlar için `@ParameterizedTest` kullanın

## Web Katmanı Testleri (MockMvc)

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

## Entegrasyon Testleri (SpringBootTest)

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

## Persistence Testleri (DataJpaTest)

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

- Production'ı yansıtmak için Postgres/Redis için yeniden kullanılabilir container'lar kullanın
- JDBC URL'lerini Spring context'e enjekte etmek için `@DynamicPropertySource` ile bağlayın

## Kapsam (JaCoCo)

Maven snippet:
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

## Assertion'lar

- Okunabilirlik için AssertJ'yi (`assertThat`) tercih edin
- JSON yanıtları için `jsonPath` kullanın
- Exception'lar için: `assertThatThrownBy(...)`

## Test Veri Builder'ları

```java
class MarketBuilder {
  private String name = "Test";
  MarketBuilder withName(String name) { this.name = name; return this; }
  Market build() { return new Market(null, name, MarketStatus.ACTIVE); }
}
```

## CI Komutları

- Maven: `mvn -T 4 test` veya `mvn verify`
- Gradle: `./gradlew test jacocoTestReport`

**Unutmayın**: Testleri hızlı, izole ve deterministik tutun. Uygulama detaylarını değil, davranışı test edin.
