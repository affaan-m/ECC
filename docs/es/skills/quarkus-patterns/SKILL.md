---
name: quarkus-patterns
description: Patrones de arquitectura Quarkus 3.x LTS con Camel para mensajería, diseño de API RESTful, servicios CDI, acceso a datos con Panache y procesamiento asíncrono.
origin: ECC
---

# Patrones de Desarrollo Quarkus

Patrones de arquitectura y API de Quarkus 3.x para servicios cloud-native y orientados a eventos con Apache Camel.

## Cuándo Activar

- Construir APIs REST con JAX-RS o RESTEasy Reactive
- Estructurar capas resource → service → repository
- Implementar patrones orientados a eventos con Apache Camel y RabbitMQ
- Configurar Hibernate Panache, caché o streams reactivos
- Agregar validación, mapeo de excepciones o paginación
- Configurar perfiles para entornos dev/staging/producción (configuración YAML)
- Logging personalizado con LogContext y Logback/Logstash encoder
- Trabajar con CompletableFuture para operaciones asíncronas
- Implementar procesamiento condicional de flujos
- Trabajar con compilación nativa GraalVM

## Capa de Servicio con Múltiples Dependencias

```java
@Slf4j
@ApplicationScoped
@RequiredArgsConstructor
public class OrderProcessingService {

    private final OrderValidator orderValidator;
    private final EventService eventService;
    private final OrderRepository orderRepository;
    private final FulfillmentPublisher fulfillmentPublisher;
    private final AuditPublisher auditPublisher;

    @Transactional
    public OrderReceipt process(CreateOrderCommand command) {
        ValidationResult validation = orderValidator.validate(command);
        if (!validation.valid()) {
            eventService.createErrorEvent(command, "ORDER_REJECTED", validation.message());
            throw new WebApplicationException(validation.message(), Response.Status.BAD_REQUEST);
        }

        Order order = Order.from(command);
        orderRepository.persist(order);

        OrderReceipt receipt = OrderReceipt.from(order);
        fulfillmentPublisher.publishAsync(receipt);
        auditPublisher.publish("ORDER_ACCEPTED", receipt);
        eventService.createSuccessEvent(receipt, "ORDER_ACCEPTED");

        log.info("Orden procesada {}", order.id);
        return receipt;
    }
}
```

**Patrones Clave:**
- `@RequiredArgsConstructor` para inyección por constructor mediante Lombok
- `@Slf4j` para logging con Logback
- `@Transactional` en métodos de servicio que escriben a través de Panache o repositorios
- Validar entrada antes de persistencia o publicación de mensajes
- Seguimiento de eventos para escenarios de éxito/error
- Publicación asíncrona de mensajes Camel

## Patrón de Contexto de Logging Personalizado (Logback)

```java
@ApplicationScoped
public class ProcessingService {

    public void processDocument(Document doc) {
        LogContext logContext = CustomLog.getCurrentContext();
        try (SafeAutoCloseable ignored = CustomLog.startScope(logContext)) {
            logContext.put("documentId", doc.getId().toString());
            logContext.put("documentType", doc.getType());
            logContext.put("userId", SecurityContext.getUserId());

            log.info("Iniciando procesamiento de documento");

            processInternal(doc);

            log.info("Procesamiento de documento completado");
        } catch (Exception e) {
            log.error("Error en el procesamiento de documento", e);
            throw e;
        }
    }
}
```

**Configuración de Logback (logback.xml):**

```xml
<configuration>
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <includeContext>true</includeContext>
            <includeMdc>true</includeMdc>
        </encoder>
    </appender>

    <logger name="com.example" level="INFO"/>
    <root level="WARN">
        <appender-ref ref="CONSOLE"/>
    </root>
</configuration>
```

## Patrón de Servicio de Eventos

```java
@Slf4j
@ApplicationScoped
@RequiredArgsConstructor
public class EventService {
    private final EventRepository eventRepository;
    private final ObjectMapper objectMapper;

    public void createSuccessEvent(Object payload, String eventType) {
        Objects.requireNonNull(payload, "El payload no puede ser null");
        Event event = new Event();
        event.setType(eventType);
        event.setStatus(EventStatus.SUCCESS);
        event.setPayload(serializePayload(payload));
        event.setTimestamp(Instant.now());

        eventRepository.persist(event);
        log.info("Evento de éxito creado: {}", eventType);
    }

    public void createErrorEvent(Object payload, String eventType, String errorMessage) {
        Objects.requireNonNull(payload, "El payload no puede ser null");
        if (errorMessage == null || errorMessage.isBlank()) {
            throw new IllegalArgumentException("El mensaje de error no puede estar en blanco");
        }
        Event event = new Event();
        event.setType(eventType);
        event.setStatus(EventStatus.ERROR);
        event.setErrorMessage(errorMessage);
        event.setPayload(serializePayload(payload));
        event.setTimestamp(Instant.now());

        eventRepository.persist(event);
        log.error("Evento de error creado: {} - {}", eventType, errorMessage);
    }

    private String serializePayload(Object payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Error al serializar el payload del evento", e);
        }
    }
}
```

## Publicación de Mensajes Camel (RabbitMQ)

```java
@Slf4j
@ApplicationScoped
@RequiredArgsConstructor
public class BusinessRulesPublisher {
    private final ProducerTemplate producerTemplate;

    public void publishSync(BusinessRulesPayload payload) {
        producerTemplate.sendBody(
            "direct:business-rules-publisher",
            payload
        );
    }
}
```

**Configuración de Ruta Camel:**

```java
@ApplicationScoped
public class BusinessRulesRoute extends RouteBuilder {

    @ConfigProperty(name = "camel.rabbitmq.queue.business-rules")
    String businessRulesQueue;

    @ConfigProperty(name = "rabbitmq.host")
    String rabbitHost;

    @ConfigProperty(name = "rabbitmq.port")
    Integer rabbitPort;

    @Override
    public void configure() {
        from("direct:business-rules-publisher")
            .routeId("business-rules-publisher")
            .log("Publicando mensaje en RabbitMQ: ${body}")
            .marshal().json(JsonLibrary.Jackson)
            .toF("spring-rabbitmq:%s?hostname=%s&portNumber=%d",
                businessRulesQueue, rabbitHost, rabbitPort);
    }
}
```

## Rutas Camel Direct (En Memoria)

```java
@ApplicationScoped
public class DocumentProcessingRoute extends RouteBuilder {

    @Override
    public void configure() {
        onException(ValidationException.class)
            .handled(true)
            .to("direct:validation-error-handler")
            .log("Error de validación: ${exception.message}");

        from("direct:process-document")
            .routeId("document-processing")
            .log("Procesando documento: ${header.documentId}")
            .bean(DocumentValidator.class, "validate")
            .bean(DocumentTransformer.class, "transform")
            .choice()
                .when(header("documentType").isEqualTo("INVOICE"))
                    .to("direct:process-invoice")
                .when(header("documentType").isEqualTo("CREDIT_NOTE"))
                    .to("direct:process-credit-note")
                .otherwise()
                    .to("direct:process-generic")
            .end();
    }
}
```

## Procesamiento de Archivos Camel

```java
@ApplicationScoped
public class FileMonitoringRoute extends RouteBuilder {

    @ConfigProperty(name = "file.input.directory")
    String inputDirectory;

    @ConfigProperty(name = "file.processed.directory")
    String processedDirectory;

    @ConfigProperty(name = "file.error.directory")
    String errorDirectory;

    @Override
    public void configure() {
        from("file:" + inputDirectory + "?move=" + processedDirectory +
             "&moveFailed=" + errorDirectory + "&delay=5000")
            .routeId("file-monitor")
            .log("Procesando archivo: ${header.CamelFileName}")
            .to("direct:process-file");
    }
}
```

## Estructura de API REST

```java
@Path("/api/documents")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@RequiredArgsConstructor
public class DocumentResource {
  private final DocumentService documentService;

  @GET
  public Response list(
      @QueryParam("page") @DefaultValue("0") int page,
      @QueryParam("size") @DefaultValue("20") int size) {
    List<Document> documents = documentService.list(page, size);
    return Response.ok(documents).build();
  }

  @POST
  public Response create(@Valid CreateDocumentRequest request, @Context UriInfo uriInfo) {
    Document document = documentService.create(request);
    URI location = uriInfo.getAbsolutePathBuilder()
        .path(String.valueOf(document.id))
        .build();
    return Response.created(location).entity(DocumentResponse.from(document)).build();
  }

  @GET
  @Path("/{id}")
  public Response getById(@PathParam("id") Long id) {
    return documentService.findById(id)
        .map(DocumentResponse::from)
        .map(Response::ok)
        .orElse(Response.status(Response.Status.NOT_FOUND))
        .build();
  }
}
```

## Patrón de Repositorio (Panache Repository)

```java
@ApplicationScoped
public class DocumentRepository implements PanacheRepository<Document> {

  public List<Document> findByStatus(DocumentStatus status, int page, int size) {
    return find("status = ?1 order by createdAt desc", status)
        .page(page, size)
        .list();
  }

  public Optional<Document> findByReferenceNumber(String referenceNumber) {
    return find("referenceNumber", referenceNumber).firstResultOptional();
  }
}
```

## Capa de Servicio con Transacciones

```java
@ApplicationScoped
@RequiredArgsConstructor
public class DocumentService {
  private final DocumentRepository repo;
  private final EventService eventService;

  @Transactional
  public Document create(CreateDocumentRequest request) {
    Document document = new Document();
    document.setReferenceNumber(request.referenceNumber());
    document.setDescription(request.description());
    document.setStatus(DocumentStatus.PENDING);
    document.setCreatedAt(Instant.now());

    repo.persist(document);

    eventService.createSuccessEvent(document, "DOCUMENT_CREATED");

    return document;
  }
}
```

## DTOs y Validación

```java
public record CreateDocumentRequest(
    @NotBlank @Size(max = 200) String referenceNumber,
    @NotBlank @Size(max = 2000) String description,
    @NotNull @FutureOrPresent Instant validUntil,
    @NotEmpty List<@NotBlank String> categories) {}

public record DocumentResponse(Long id, String referenceNumber, DocumentStatus status) {
  public static DocumentResponse from(Document document) {
    return new DocumentResponse(document.getId(), document.getReferenceNumber(),
        document.getStatus());
  }
}
```

## Mapeo de Excepciones

```java
@Provider
public class ValidationExceptionMapper implements ExceptionMapper<ConstraintViolationException> {
  @Override
  public Response toResponse(ConstraintViolationException exception) {
    String message = exception.getConstraintViolations().stream()
        .map(cv -> cv.getPropertyPath() + ": " + cv.getMessage())
        .collect(Collectors.joining(", "));

    return Response.status(Response.Status.BAD_REQUEST)
        .entity(Map.of("error", "validation_error", "message", message))
        .build();
  }
}
```

## Operaciones Asíncronas con CompletableFuture

```java
@Slf4j
@ApplicationScoped
@RequiredArgsConstructor
public class FileStorageService {
    private final S3Client s3Client;
    private final ExecutorService executorService;

    public CompletableFuture<StoredDocumentInfo> uploadOriginalFile(
            InputStream inputStream,
            long size,
            LogContext logContext,
            InvoiceFormat format) {

        return CompletableFuture.supplyAsync(() -> {
            try (SafeAutoCloseable ignored = CustomLog.startScope(logContext)) {
                String path = generateStoragePath(format);

                PutObjectRequest request = PutObjectRequest.builder()
                    .bucket(bucketName)
                    .key(path)
                    .contentLength(size)
                    .build();

                s3Client.putObject(request, RequestBody.fromInputStream(inputStream, size));

                return new StoredDocumentInfo(path, size, Instant.now());
            } catch (Exception e) {
                log.error("Error al subir archivo a S3", e);
                throw new StorageException("Subida fallida", e);
            }
        }, executorService);
    }
}
```

## Caché

```java
@ApplicationScoped
@RequiredArgsConstructor
public class DocumentCacheService {
  private final DocumentRepository repo;

  @CacheResult(cacheName = "document-cache")
  public Optional<Document> getById(@CacheKey Long id) {
    return repo.findByIdOptional(id);
  }

  @CacheInvalidate(cacheName = "document-cache")
  public void evict(@CacheKey Long id) {}
}
```

## Configuración como YAML

```yaml
# application.yml
"%dev":
  quarkus:
    datasource:
      jdbc:
        url: jdbc:postgresql://localhost:5432/dev_db
      username: dev_user
      password: ${DB_PASSWORD}

"%test":
  quarkus:
    datasource:
      jdbc:
        url: jdbc:h2:mem:test
    hibernate-orm:
      database:
        generation: drop-and-create

"%prod":
  quarkus:
    datasource:
      jdbc:
        url: ${DATABASE_URL}
      username: ${DB_USER}
      password: ${DB_PASSWORD}
```

## Health Checks

```java
@Readiness
@ApplicationScoped
@RequiredArgsConstructor
public class DatabaseHealthCheck implements HealthCheck {
  private final AgroalDataSource dataSource;

  @Override
  public HealthCheckResponse call() {
    try (Connection conn = dataSource.getConnection()) {
      boolean valid = conn.isValid(2);
      return HealthCheckResponse.named("Database connection")
          .status(valid)
          .build();
    } catch (SQLException e) {
      return HealthCheckResponse.down("Database connection");
    }
  }
}
```

## Dependencias (Maven)

```xml
<properties>
    <quarkus.platform.version>3.27.0</quarkus.platform.version>
    <lombok.version>1.18.42</lombok.version>
    <assertj-core.version>3.24.2</assertj-core.version>
    <jacoco-maven-plugin.version>0.8.13</jacoco-maven-plugin.version>
    <maven.compiler.release>17</maven.compiler.release>
</properties>
```

## Buenas Prácticas

### Arquitectura
- Usar `@RequiredArgsConstructor` con Lombok para inyección por constructor
- Mantener la capa de servicio delgada; delegar lógica compleja a clases especializadas
- Usar rutas Camel para enrutamiento de mensajes y patrones de integración
- Preferir el patrón Panache Repository para acceso a datos

### Orientado a Eventos
- Siempre rastrear operaciones con EventService (eventos de éxito/error)
- Usar endpoints `direct:` de Camel para enrutamiento en memoria
- Usar el componente `spring-rabbitmq` para integración con RabbitMQ

### Logging
- Usar Logback con Logstash encoder para logging estructurado
- Propagar LogContext a través de llamadas de servicio con `SafeAutoCloseable`
- Usar `@Slf4j` en lugar de instanciación manual del logger

### Configuración
- Usar configuración YAML (`quarkus-config-yaml`)
- Configuración consciente de perfil para entornos dev/test/prod
- Externalizar configuración sensible a variables de entorno
