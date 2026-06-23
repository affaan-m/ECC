---
name: springboot-tdd
description: Desarrollo guiado por pruebas para Spring Boot usando JUnit 5, Mockito, MockMvc, Testcontainers y JaCoCo. Usar al agregar funcionalidades, corregir bugs o refactorizar.
origin: ECC
---

# Flujo de Trabajo TDD en Spring Boot

Orientación TDD para servicios Spring Boot con 80%+ de cobertura (unit + integración).

## Cuándo Usar

- Nuevas funcionalidades o endpoints
- Correcciones de bugs o refactorizaciones
- Agregar lógica de acceso a datos o reglas de seguridad

## Flujo de Trabajo

1) Escribir pruebas primero (deben fallar)
2) Implementar el código mínimo para que pasen
3) Refactorizar con pruebas en verde
4) Exigir cobertura con JaCoCo

## Pruebas Unitarias (JUnit 5 + Mockito)

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

Patrones:
- Arrange-Act-Assert
- Evitar mocks parciales; preferir stubbing explícito
- Usar `@ParameterizedTest` para variantes

## Pruebas de Capa Web (MockMvc)

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

## Pruebas de Integración (SpringBootTest)

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

## Pruebas de Persistencia (DataJpaTest)

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

- Usar contenedores reutilizables para Postgres/Redis que reflejen producción
- Conectar mediante `@DynamicPropertySource` para inyectar URLs JDBC en el contexto de Spring

## Cobertura (JaCoCo)

Fragmento Maven:
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

## Aserciones

- Preferir AssertJ (`assertThat`) para legibilidad
- Para respuestas JSON, usar `jsonPath`
- Para excepciones: `assertThatThrownBy(...)`

## Builders de Datos de Prueba

```java
class MarketBuilder {
  private String name = "Test";
  MarketBuilder withName(String name) { this.name = name; return this; }
  Market build() { return new Market(null, name, MarketStatus.ACTIVE); }
}
```

## Comandos de CI

- Maven: `mvn -T 4 test` o `mvn verify`
- Gradle: `./gradlew test jacocoTestReport`

**Recuerda**: Mantener las pruebas rápidas, aisladas y deterministas. Probar comportamiento, no detalles de implementación.
