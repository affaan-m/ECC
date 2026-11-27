---
name: quarkus-patterns
description: Quarkus 3.x LTS architecture patterns with Camel for messaging, RESTful API design, CDI services, data access with Panache, and async processing. Use for Java Quarkus backend work with event-driven architectures.
origin: ECC
---

# Quarkus Geliştirme Desenleri

Apache Camel ile bulut-native, event-driven servisler için Quarkus 3.x mimari ve API desenleri.

## When to Use

- JAX-RS veya RESTEasy Reactive ile REST API'leri oluşturma
- Resource → service → repository katmanlarını yapılandırma
- Apache Camel ve RabbitMQ ile event-driven desenler uygulama
- Hibernate Panache, caching veya reaktif akışları yapılandırma
- Validation, exception mapping veya sayfalama ekleme
- Dev/staging/production ortamları için profiller kurma (YAML yapılandırma)
- LogContext ve Logback/Logstash encoder ile özel loglama
- Async işlemler için CompletableFuture ile çalışma
- Koşullu akış işleme uygulama
- GraalVM native derleme ile çalışma

## How It Works

Quarkus servislerinde Resource -> service -> repository akışını CDI scope'ları,
`@Transactional` sınırları, Panache/Hibernate veri erişimi ve Camel/RabbitMQ
entegrasyonlarıyla birlikte uygulayın. Aşağıdaki örnekler event üretimi,
dosya işleme, özel logging context ve async yayınlama için kopyalanabilir
başlangıç noktaları sağlar.

## Examples

### Birden Fazla Bağımlılıklı Service Katmanı (Lombok)

```java
@Slf4j
@ApplicationScoped
@RequiredArgsConstructor
public class As2ProcessingService {

    private final InvoiceFlowValidator invoiceFlowValidator;
    private final EventService eventService;
    private final DocumentJobService documentJobService;
    private final BusinessRulesPublisher businessRulesPublisher;
    private final FileStorageService fileStorageService;

    public void processFile(Path filePath) throws Exception {
        LogContext logContext = CustomLog.getCurrentContext();
        try (SafeAutoCloseable ignored = CustomLog.startScope(logContext)) {

            String structureIdPartner = logContext.get(As2Constants.STRUCTURE_ID);

            // Koşullu akış mantığı
            boolean isChorusFlow = Boolean.parseBoolean(logContext.get(As2Constants.CHORUS_FLOW));
            log.info("Is CHORUS_FLOW message: {}", isChorusFlow);

            ValidationFlowConfig validationFlowConfig = isChorusFlow
                    ? ValidationFlowConfig.xsdOnly()
                    : ValidationFlowConfig.allValidations();

            InvoiceValidationResult invoiceValidationResult = this.invoiceFlowValidator
                    .validateFlowWithConfig(filePath, validationFlowConfig,
                        EInvoiceSyntaxFormat.UBL, logContext);

            FlowProfile flowProfile = isChorusFlow ?
                    FlowProfile.EXTENDED_CTC_FR :
                    this.invoiceFlowValidator.computeFlowProfile(invoiceValidationResult,
                        invoiceValidationResult.getInvoiceDetails().invoiceFormat().getProfile());

            log.info("Invoice validation completed. Message is valid");

            // CompletableFuture async işlemi
            try(InputStream inputStream = Files.newInputStream(filePath)) {
                CompletableFuture<StoredDocumentInfo> documentInfoCompletableFuture =
                    fileStorageService.uploadOriginalFile(inputStream,
                        invoiceValidationResult.getSize(), logContext,
                        invoiceValidationResult.getInvoiceFormat());

                StoredDocumentInfo documentInfo = documentInfoCompletableFuture.join();
                log.info("File uploaded successfully: {}", documentInfo.getPath());

                if (StringUtils.isBlank(documentInfo.getPath())) {
                    String errorMsg = "File path is empty after upload";
                    log.error(errorMsg);
                    this.eventService.createErrorEvent(documentInfo, "FILE_UPLOAD_FAILED", errorMsg);
                    throw new As2ServerProcessingException(errorMsg);
                }

                this.eventService.createSuccessEvent(documentInfo, "PERSISTENCE_BLOB_EVENT_TYPE");

                String originalFileName = documentInfo.getOriginalFileName();
                BusinessRulesPayload payload = this.documentJobService.createDocumentAndJobEntities(
                    documentInfo, originalFileName, structureIdPartner,
                    flowProfile, invoiceValidationResult.getDocumentHash());

                // Async Camel yayınlama
                businessRulesPublisher.publishAsync(payload);
                this.eventService.createSuccessEvent(payload, "BUSINESS_RULES_MESSAGE_SENT");
            }
        }
    }
}
```

**Temel Desenler:**
- Constructor injection için Lombok üzerinden `@RequiredArgsConstructor`
- Logback loglama için `@Slf4j`
- try-with-resources ile kapsamlı LogContext
- Runtime parametrelerine dayalı koşullu akış mantığı
- Async işlemler için `.join()` ile CompletableFuture
- Başarı/hata senaryoları için event takibi
- Async Camel mesaj yayınlama

## Özel Loglama Bağlamı Deseni (Logback)

```java
@ApplicationScoped
public class ProcessingService {

    public void processDocument(Document doc) {
        LogContext logContext = CustomLog.getCurrentContext();
        try (SafeAutoCloseable ignored = CustomLog.startScope(logContext)) {
            // Tüm log ifadelerine bağlam ekle
            logContext.put("documentId", doc.getId().toString());
            logContext.put("documentType", doc.getType());
            logContext.put("userId", SecurityContext.getUserId());

            log.info("Starting document processing");

            // Bu kapsam içindeki tüm loglar bağlamı devralır
            processInternal(doc);

            log.info("Document processing completed");
        } catch (Exception e) {
            log.error("Document processing failed", e);
            throw e;
        }
    }
}
```

**Logback Yapılandırması (logback.xml):**

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

### Event Service Deseni

```java
@Slf4j
@ApplicationScoped
@RequiredArgsConstructor
public class EventService {
    private final EventRepository eventRepository;
    private final ObjectMapper objectMapper;

    public void createSuccessEvent(Object payload, String eventType) {
        Objects.requireNonNull(payload, "Payload cannot be null");
        Event event = new Event();
        event.setType(eventType);
        event.setStatus(EventStatus.SUCCESS);
        event.setPayload(serializePayload(payload));
        event.setTimestamp(Instant.now());

        eventRepository.persist(event);
        log.info("Success event created: {}", eventType);
    }

    public void createErrorEvent(Object payload, String eventType, String errorMessage) {
        Objects.requireNonNull(payload, "Payload cannot be null");
        if (errorMessage == null || errorMessage.isBlank()) {
            throw new IllegalArgumentException("Error message cannot be blank");
        }
        Event event = new Event();
        event.setType(eventType);
        event.setStatus(EventStatus.ERROR);
        event.setErrorMessage(errorMessage);
        event.setPayload(serializePayload(payload));
        event.setTimestamp(Instant.now());

        eventRepository.persist(event);
        log.error("Error event created: {} - {}", eventType, errorMessage);
    }

    private String serializePayload(Object payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize event payload", e);
        }
    }
}
```

## Camel Mesaj Yayınlama (RabbitMQ)

```java
@ApplicationScoped
@RequiredArgsConstructor
public class BusinessRulesPublisher {
    private final ProducerTemplate producerTemplate;

    @ConfigProperty(name = "camel.rabbitmq.queue.business-rules")
    String businessRulesQueue;

    public void publishAsync(BusinessRulesPayload payload) {
        producerTemplate.asyncSendBody(
            "direct:business-rules-publisher",
            payload
        );
        log.info("Message published to business rules queue: {}", payload.getDocumentId());
    }

    public void publishSync(BusinessRulesPayload payload) {
        producerTemplate.sendBody(
            "direct:business-rules-publisher",
            payload
        );
    }
}
```

**Camel Route Yapılandırması:**

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
            .log("Publishing message to RabbitMQ: ${body}")
            .marshal().json(JsonLibrary.Jackson)
            .toF("spring-rabbitmq:%s?hostname=%s&portNumber=%d",
                businessRulesQueue, rabbitHost, rabbitPort);
    }
}
```

## Camel Direct Route'ları (Bellek İçi)

```java
@ApplicationScoped
public class DocumentProcessingRoute extends RouteBuilder {

    @Override
    public void configure() {
        // Hata yönetimi
        onException(ValidationException.class)
            .handled(true)
            .to("direct:validation-error-handler")
            .log("Validation error: ${exception.message}");

        // Ana işleme route'u
        from("direct:process-document")
            .routeId("document-processing")
            .log("Processing document: ${header.documentId}")
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

        from("direct:validation-error-handler")
            .bean(EventService.class, "createErrorEvent")
            .log("Validation error handled");
    }
}
```

## Camel Dosya İşleme

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
            .log("Processing file: ${header.CamelFileName}")
            .to("direct:process-file");

        from("direct:process-file")
            .bean(As2ProcessingService.class, "processFile")
            .log("File processing completed");
    }
}
```

## Camel Bean Çağrısı

```java
@ApplicationScoped
public class InvoiceRoute extends RouteBuilder {

    @Override
    public void configure() {
        from("direct:invoice-validation")
            .bean(InvoiceFlowValidator.class, "validateFlowWithConfig")
            .log("Validation result: ${body}");

        from("direct:persist-and-publish")
            .bean(DocumentJobService.class, "createDocumentAndJobEntities")
            .bean(BusinessRulesPublisher.class, "publishAsync")
            .bean(EventService.class, "createSuccessEvent(${body}, 'PUBLISHED')");
    }
}
```

## REST API Yapısı

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

## Repository Deseni (Panache Repository)

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

  public long countByStatusAndDate(DocumentStatus status, LocalDate date) {
    return count("status = ?1 and createdAt >= ?2", status, date.atStartOfDay());
  }
}
```

## Transaction'lı Service Katmanı

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

  public Optional<Document> findById(Long id) {
    return repo.findByIdOptional(id);
  }

  public List<Document> list(int page, int size) {
    return repo.findAll()
        .page(page, size)
        .list();
  }
}
```

## DTO'lar ve Validation

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

## Exception Eşleme

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

@Provider
@Slf4j
public class GenericExceptionMapper implements ExceptionMapper<Exception> {

  @Override
  public Response toResponse(Exception exception) {
    log.error("Unhandled exception", exception);
    return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
        .entity(Map.of("error", "internal_error", "message", "An unexpected error occurred"))
        .build();
  }
}
```

## CompletableFuture Async İşlemleri

```java
@Slf4j
@ApplicationScoped
@RequiredArgsConstructor
public class FileStorageService {
    private final S3Client s3Client;
    private final ExecutorService executorService;

    @ConfigProperty(name = "storage.bucket-name") String bucketName;

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

                log.info("File uploaded to S3: {}", path);

                return new StoredDocumentInfo(path, size, Instant.now());
            } catch (Exception e) {
                log.error("Failed to upload file to S3", e);
                throw new StorageException("Upload failed", e);
            }
        }, executorService);
    }
}
```

## Caching

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

  @CacheInvalidateAll(cacheName = "document-cache")
  public void evictAll() {}
}
```

## YAML Yapılandırması

```yaml
# application.yml (uygulama yapılandırması)
"%dev":
  quarkus:
    datasource:
      jdbc:
        url: jdbc:postgresql://localhost:5432/dev_db
      username: dev_user
      password: dev_pass
    hibernate-orm:
      database:
        generation: drop-and-create

  rabbitmq:
    host: localhost
    port: 5672
    username: guest
    password: guest

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
    hibernate-orm:
      database:
        generation: validate

  rabbitmq:
    host: ${RABBITMQ_HOST}
    port: ${RABBITMQ_PORT}
    username: ${RABBITMQ_USER}
    password: ${RABBITMQ_PASSWORD}

# Camel yapılandırması
camel:
  rabbitmq:
    queue:
      business-rules: business-rules-queue
      invoice-processing: invoice-processing-queue
```

## Sağlık Kontrolleri

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

@Liveness
@ApplicationScoped
public class CamelHealthCheck implements HealthCheck {
  @Inject
  CamelContext camelContext;

  @Override
  public HealthCheckResponse call() {
    boolean isStarted = camelContext.getStatus().isStarted();
    return HealthCheckResponse.named("Camel Context")
        .status(isStarted)
        .build();
  }
}
```

## Bağımlılıklar (Maven)

```xml
<properties>
    <quarkus.platform.version>3.27.0</quarkus.platform.version>
    <lombok.version>1.18.42</lombok.version>
    <assertj-core.version>3.24.2</assertj-core.version>
    <jacoco-maven-plugin.version>0.8.13</jacoco-maven-plugin.version>
    <maven.compiler.release>17</maven.compiler.release>
</properties>

<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>io.quarkus.platform</groupId>
            <artifactId>quarkus-bom</artifactId>
            <version>${quarkus.platform.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
        <dependency>
            <groupId>io.quarkus.platform</groupId>
            <artifactId>quarkus-camel-bom</artifactId>
            <version>${quarkus.platform.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <!-- Quarkus Çekirdek -->
    <dependency>
        <groupId>io.quarkus</groupId>
        <artifactId>quarkus-arc</artifactId>
    </dependency>
    <dependency>
        <groupId>io.quarkus</groupId>
        <artifactId>quarkus-config-yaml</artifactId>
    </dependency>

    <!-- Camel Uzantıları -->
    <dependency>
        <groupId>org.apache.camel.quarkus</groupId>
        <artifactId>camel-quarkus-spring-rabbitmq</artifactId>
    </dependency>
    <dependency>
        <groupId>org.apache.camel.quarkus</groupId>
        <artifactId>camel-quarkus-direct</artifactId>
    </dependency>
    <dependency>
        <groupId>org.apache.camel.quarkus</groupId>
        <artifactId>camel-quarkus-bean</artifactId>
    </dependency>

    <!-- Lombok -->
    <dependency>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <version>${lombok.version}</version>
        <scope>provided</scope>
    </dependency>

    <!-- Loglama -->
    <dependency>
        <groupId>io.quarkiverse.logging.logback</groupId>
        <artifactId>quarkus-logging-logback</artifactId>
    </dependency>
    <dependency>
        <groupId>net.logstash.logback</groupId>
        <artifactId>logstash-logback-encoder</artifactId>
    </dependency>
</dependencies>
```

## En İyi Uygulamalar

### Mimari
- Constructor injection için Lombok üzerinden `@RequiredArgsConstructor` kullanın
- Service katmanını ince tutun; karmaşık mantığı uzmanlaşmış sınıflara devredin
- Mesaj yönlendirme ve entegrasyon desenleri için Camel route'larını kullanın
- Veri erişimi için Panache Repository desenini tercih edin

### Event-Driven
- EventService ile işlemleri her zaman takip edin (başarı/hata eventleri)
- Bellek içi yönlendirme için Camel `direct:` endpoint'leri kullanın
- RabbitMQ entegrasyonu için `spring-rabbitmq` bileşenini kullanın
- `ProducerTemplate.asyncSendBody()` ile async yayınlama uygulayın

### Loglama
- Yapılandırılmış loglama için Logstash encoder ile Logback kullanın
- LogContext'i `SafeAutoCloseable` ile servis çağrıları boyunca yayın
- İstek takibi için LogContext'e bağlamsal bilgi ekleyin
- Manuel logger oluşturma yerine `@Slf4j` kullanın

### Async İşlemler
- Bloklamayan I/O işlemleri için CompletableFuture kullanın
- Tamamlanmayı beklemek gerektiğinde `.join()` çağırın
- CompletableFuture'dan gelen exception'ları düzgün şekilde ele alın
- Takip için async işlemlere LogContext geçirin

### Yapılandırma
- YAML yapılandırmasını kullanın (`quarkus-config-yaml`)
- Dev/test/prod ortamları için profil-duyarlı yapılandırma
- Hassas yapılandırmayı ortam değişkenlerine dışsallaştırın
- Tip-güvenli yapılandırma injection için `@ConfigProperty` kullanın

### Validation
- Resource katmanında `@Valid` ile doğrulayın
- DTO'larda Bean Validation annotasyonları kullanın
- Exception'ları `@Provider` ile uygun HTTP yanıtlarına eşleyin

### Transaction'lar
- Veri değiştiren service metodlarında `@Transactional` kullanın
- Transaction'ları kısa ve odaklı tutun
- Transaction'lar içinden async işlem çağırmaktan kaçının

### Test
- Route testi için `camel-quarkus-junit5` kullanın
- Assertion'lar için AssertJ kullanın
- Tüm harici bağımlılıkları mock'layın
- Koşullu akış mantığını kapsamlı biçimde test edin

### Quarkus'a Özgü
- En son LTS sürümünde kalın (3.x)
- Hot reload için Quarkus dev modunu kullanın
- Production hazırlığı için sağlık kontrolleri ekleyin
- Native derleme uyumluluğunu periyodik olarak test edin
