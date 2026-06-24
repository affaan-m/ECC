---
name: quarkus-tdd
description: Desarrollo guiado por pruebas para Quarkus 3.x LTS usando JUnit 5, Mockito, REST Assured, pruebas Camel y JaCoCo. Usar al agregar funcionalidades, corregir bugs o refactorizar servicios orientados a eventos.
origin: ECC
---

# Flujo de Trabajo TDD en Quarkus

Orientación TDD para servicios Quarkus 3.x con 80%+ de cobertura (unit + integración). Optimizado para arquitecturas orientadas a eventos con Apache Camel.

## Cuándo Usar

- Nuevas funcionalidades o endpoints REST
- Correcciones de bugs o refactorizaciones
- Agregar lógica de acceso a datos, reglas de seguridad o streams reactivos
- Probar rutas Apache Camel y manejadores de eventos
- Probar servicios orientados a eventos con RabbitMQ
- Probar lógica de flujo condicional
- Validar operaciones asíncronas con CompletableFuture
- Probar propagación de LogContext

## Flujo de Trabajo

1. Escribir pruebas primero (deben fallar)
2. Implementar el código mínimo para que pasen
3. Refactorizar con pruebas en verde
4. Exigir cobertura con JaCoCo (objetivo 80%+)

## Pruebas Unitarias con Organización @Nested

```java
@ExtendWith(MockitoExtension.class)
@DisplayName("Pruebas Unitarias de OrderService")
class OrderServiceTest {

  @Mock
  private OrderRepository orderRepository;

  @Mock
  private EventService eventService;

  @Mock
  private FulfillmentPublisher fulfillmentPublisher;

  @InjectMocks
  private OrderService orderService;

  private CreateOrderCommand validCommand;

  @BeforeEach
  void setUp() {
    validCommand = new CreateOrderCommand(
        "customer-123",
        List.of(new OrderLine("sku-123", 2))
    );
  }

  @Nested
  @DisplayName("Pruebas para createOrder")
  class CreateOrder {

    @Test
    @DisplayName("Debe persistir orden y publicar evento de fulfillment")
    void givenValidCommand_whenCreateOrder_thenPersistsAndPublishes() {
      // ARRANGE
      doNothing().when(orderRepository).persist(any(Order.class));

      // ACT
      OrderReceipt receipt = orderService.createOrder(validCommand);

      // ASSERT
      assertThat(receipt).isNotNull();
      assertThat(receipt.customerId()).isEqualTo("customer-123");
      verify(orderRepository).persist(any(Order.class));
      verify(fulfillmentPublisher).publishAsync(receipt);
      verify(eventService).createSuccessEvent(receipt, "ORDER_CREATED");
    }

    @Test
    @DisplayName("Debe rechazar customer id vacío")
    void givenMissingCustomerId_whenCreateOrder_thenThrowsBadRequest() {
      // ARRANGE
      CreateOrderCommand invalid = new CreateOrderCommand("", validCommand.lines());

      // ACT & ASSERT
      WebApplicationException exception = assertThrows(
          WebApplicationException.class,
          () -> orderService.createOrder(invalid)
      );

      assertThat(exception.getResponse().getStatus()).isEqualTo(400);
      verify(orderRepository, never()).persist(any(Order.class));
      verify(fulfillmentPublisher, never()).publishAsync(any());
    }

    @Test
    @DisplayName("Debe registrar evento de error cuando falla la persistencia")
    void givenPersistenceFailure_whenCreateOrder_thenRecordsErrorEvent() {
      // ARRANGE
      doThrow(new PersistenceException("base de datos no disponible"))
          .when(orderRepository).persist(any(Order.class));

      // ACT & ASSERT
      PersistenceException exception = assertThrows(
          PersistenceException.class,
          () -> orderService.createOrder(validCommand)
      );

      assertThat(exception.getMessage()).contains("base de datos no disponible");
      verify(eventService).createErrorEvent(
          eq(validCommand),
          eq("ORDER_CREATE_FAILED"),
          contains("base de datos no disponible")
      );
      verify(fulfillmentPublisher, never()).publishAsync(any());
    }
  }
}
```

### Patrones Clave de Prueba

1. **Clases @Nested**: Agrupar pruebas por método bajo prueba
2. **@DisplayName**: Proporcionar descripciones legibles para reportes
3. **Convención de nombres**: `givenX_whenY_thenZ` para claridad
4. **Patrón AAA**: Comentarios explícitos `// ARRANGE`, `// ACT`, `// ASSERT`
5. **@BeforeEach**: Configurar datos de prueba comunes para reducir duplicación
6. **assertDoesNotThrow**: Probar escenarios exitosos sin capturar excepciones
7. **assertThrows**: Probar escenarios de excepción con validación de mensajes
8. **verify()**: Asegurar que los métodos sean llamados correctamente
9. **never()**: Asegurar que los métodos NO sean llamados en escenarios de error

## Pruebas de Rutas Camel

```java
@QuarkusTest
@DisplayName("Pruebas de Ruta Camel Business Rules")
class BusinessRulesRouteTest {

  @Inject
  CamelContext camelContext;

  @Inject
  ProducerTemplate producerTemplate;

  @InjectMock
  EventService eventService;

  @InjectMock
  DocumentValidator documentValidator;

  private BusinessRulesPayload testPayload;

  @BeforeEach
  void setUp() {
    testPayload = new BusinessRulesPayload();
    testPayload.setDocumentId(1L);
    testPayload.setFlowProfile(FlowProfile.BASIC);
  }

  @Nested
  @DisplayName("Pruebas para ruta business-rules-publisher")
  class BusinessRulesPublisher {

    @Test
    @DisplayName("Debe publicar mensaje exitosamente en RabbitMQ")
    void givenValidPayload_whenPublish_thenMessageSentToQueue() throws Exception {
      // ARRANGE
      MockEndpoint mockRabbitMQ = camelContext.getEndpoint("mock:rabbitmq", MockEndpoint.class);
      mockRabbitMQ.expectedMessageCount(1);

      camelContext.getRouteController().stopRoute("business-rules-publisher");
      AdviceWith.adviceWith(camelContext, "business-rules-publisher", advice -> {
        advice.replaceFromWith("direct:business-rules-publisher");
        advice.weaveByToString(".*spring-rabbitmq.*").replace().to("mock:rabbitmq");
      });
      camelContext.getRouteController().startRoute("business-rules-publisher");

      // ACT
      producerTemplate.sendBody("direct:business-rules-publisher", testPayload);

      // ASSERT
      mockRabbitMQ.assertIsSatisfied(5000);

      assertThat(mockRabbitMQ.getExchanges()).hasSize(1);
      String body = mockRabbitMQ.getExchanges().get(0).getIn().getBody(String.class);
      assertThat(body).contains("\"documentId\":1");
    }
  }
}
```

## Pruebas de Servicios de Eventos

```java
@ExtendWith(MockitoExtension.class)
@DisplayName("Pruebas Unitarias de EventService")
class EventServiceTest {

  @Mock
  private EventRepository eventRepository;

  @Mock
  private ObjectMapper objectMapper;

  @InjectMocks
  private EventService eventService;

  @Nested
  @DisplayName("Pruebas para createSuccessEvent")
  class CreateSuccessEvent {

    @Test
    @DisplayName("Debe crear evento de éxito con atributos correctos")
    void givenValidPayload_whenCreateSuccessEvent_thenEventPersisted() throws Exception {
      // ARRANGE
      BusinessRulesPayload testPayload = new BusinessRulesPayload();
      testPayload.setDocumentId(1L);
      when(objectMapper.writeValueAsString(testPayload)).thenReturn("{\"documentId\":1}");

      // ACT
      assertDoesNotThrow(() ->
          eventService.createSuccessEvent(testPayload, "DOCUMENT_PROCESSED"));

      // ASSERT
      verify(eventRepository).persist(argThat(event ->
          event.getType().equals("DOCUMENT_PROCESSED") &&
          event.getStatus() == EventStatus.SUCCESS &&
          event.getTimestamp() != null
      ));
    }

    @Test
    @DisplayName("Debe lanzar excepción cuando el payload es null")
    void givenNullPayload_whenCreateSuccessEvent_thenThrowsException() {
      // ARRANGE
      Object nullPayload = null;

      // ACT & ASSERT
      NullPointerException exception = assertThrows(
          NullPointerException.class,
          () -> eventService.createSuccessEvent(nullPayload, "EVENT_TYPE")
      );

      assertThat(exception.getMessage()).isEqualTo("Payload cannot be null");
      verify(eventRepository, never()).persist(any());
    }
  }

  @Nested
  @DisplayName("Pruebas para createErrorEvent")
  class CreateErrorEvent {

    @ParameterizedTest
    @DisplayName("Debe rechazar mensajes de error inválidos")
    @ValueSource(strings = {"", " "})
    void givenBlankErrorMessage_whenCreateErrorEvent_thenThrowsException(String blankMessage) {
      // ARRANGE
      BusinessRulesPayload testPayload = new BusinessRulesPayload();

      // ACT & ASSERT
      IllegalArgumentException exception = assertThrows(
          IllegalArgumentException.class,
          () -> eventService.createErrorEvent(testPayload, "ERROR", blankMessage)
      );

      assertThat(exception.getMessage()).contains("Error message cannot be blank");
    }
  }
}
```

## Pruebas de CompletableFuture

```java
@ExtendWith(MockitoExtension.class)
class FileStorageServiceTest {

  @Mock
  private S3Client s3Client;

  @Mock
  private ExecutorService executorService;

  @InjectMocks
  private FileStorageService fileStorageService;

  @Test
  @DisplayName("Debe manejar fallo de S3")
  void givenS3Failure_whenUpload_thenCompletableFutureFails() {
    // ARRANGE — ejecutar sincrónicamente para que la excepción se propague
    doAnswer(invocation -> {
      ((Runnable) invocation.getArgument(0)).run();
      return null;
    }).when(executorService).execute(any(Runnable.class));

    when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
        .thenThrow(new StorageException("S3 no disponible"));

    // ACT
    CompletableFuture<StoredDocumentInfo> future =
        fileStorageService.uploadOriginalFile(testInputStream, 1024L,
            testLogContext, InvoiceFormat.UBL);

    // ASSERT
    assertThatThrownBy(() -> future.join())
        .isInstanceOf(CompletionException.class)
        .hasCauseInstanceOf(StorageException.class)
        .hasMessageContaining("S3 no disponible");
  }
}
```

## Pruebas de Capa de Recurso (REST Assured)

```java
@QuarkusTest
@DisplayName("Pruebas de API DocumentResource")
class DocumentResourceTest {

  @InjectMock
  DocumentService documentService;

  @Test
  @DisplayName("Debe crear documento y retornar 201")
  void givenValidRequest_whenCreate_thenReturns201() {
    // ARRANGE
    Document document = createDocument(1L, "DOC-001");
    when(documentService.create(any())).thenReturn(document);

    // ACT & ASSERT
    given()
        .contentType(ContentType.JSON)
        .body("""
            {
              "referenceNumber": "DOC-001",
              "description": "Documento de prueba",
              "validUntil": "2030-01-01T00:00:00Z",
              "categories": ["test"]
            }
            """)
        .when().post("/api/documents")
        .then()
        .statusCode(201)
        .header("Location", containsString("/api/documents/1"))
        .body("referenceNumber", equalTo("DOC-001"));
  }

  @Test
  @DisplayName("Debe retornar 400 para entrada inválida")
  void givenInvalidRequest_whenCreate_thenReturns400() {
    given()
        .contentType(ContentType.JSON)
        .body("""
            {
              "referenceNumber": "",
              "description": "Test"
            }
            """)
        .when().post("/api/documents")
        .then()
        .statusCode(400);
  }
}
```

## Cobertura con JaCoCo

### Configuración Maven (Completa)

```xml
<plugin>
  <groupId>org.jacoco</groupId>
  <artifactId>jacoco-maven-plugin</artifactId>
  <version>0.8.13</version>
  <executions>
    <execution>
      <id>prepare-agent</id>
      <goals>
        <goal>prepare-agent</goal>
      </goals>
    </execution>
    <execution>
      <id>report</id>
      <phase>verify</phase>
      <goals>
        <goal>report</goal>
      </goals>
    </execution>
    <execution>
      <id>check</id>
      <goals>
        <goal>check</goal>
      </goals>
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
              <limit>
                <counter>BRANCH</counter>
                <value>COVEREDRATIO</value>
                <minimum>0.70</minimum>
              </limit>
            </limits>
          </rule>
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Ejecutar pruebas con cobertura:
```bash
mvn clean test
mvn jacoco:report
mvn jacoco:check

# Reporte en: target/site/jacoco/index.html
```

## Dependencias de Prueba

```xml
<dependencies>
    <dependency>
        <groupId>io.quarkus</groupId>
        <artifactId>quarkus-junit5</artifactId>
        <scope>test</scope>
    </dependency>
    <dependency>
        <groupId>io.quarkus</groupId>
        <artifactId>quarkus-junit5-mockito</artifactId>
        <scope>test</scope>
    </dependency>
    <dependency>
        <groupId>org.assertj</groupId>
        <artifactId>assertj-core</artifactId>
        <version>3.24.2</version>
        <scope>test</scope>
    </dependency>
    <dependency>
        <groupId>io.rest-assured</groupId>
        <artifactId>rest-assured</artifactId>
        <scope>test</scope>
    </dependency>
    <dependency>
        <groupId>org.apache.camel.quarkus</groupId>
        <artifactId>camel-quarkus-junit5</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
```

## Buenas Prácticas

### Organización de Pruebas
- Usar clases `@Nested` para agrupar pruebas por método bajo prueba
- Usar `@DisplayName` para descripciones legibles en reportes
- Seguir la convención de nombres `givenX_whenY_thenZ`
- Usar `@BeforeEach` para configuración de datos comunes

### Cobertura de Pruebas
- Probar rutas felices para todos los métodos públicos
- Probar manejo de entradas null
- Probar casos borde (colecciones vacías, valores de frontera)
- Probar escenarios de excepción de forma comprensiva
- Apuntar a 80%+ de cobertura de líneas, 70%+ de ramas

### Aserciones
- **Preferir AssertJ** (`assertThat`) sobre aserciones JUnit para verificar valores
- Para excepciones: usar JUnit `assertThrows` para capturar, luego AssertJ para validar
- Para escenarios exitosos sin excepción: usar JUnit `assertDoesNotThrow`

### Pruebas de Integración
- Usar `@QuarkusTest` para pruebas de integración
- Usar `@InjectMock` para mockear dependencias en pruebas Quarkus
- Preferir REST Assured para pruebas de API
- Usar `@TestProfile` para configuración específica de prueba
