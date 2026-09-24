---
name: quarkus-tdd
description: Test-driven development for Quarkus 3.x LTS using JUnit 5, Mockito, REST Assured, Camel testing, and JaCoCo. Use when adding features, fixing bugs, or refactoring event-driven services.
origin: ECC
---

# Quarkus TDD İş Akışı

80%+ kapsam (unit + integration) ile Quarkus 3.x servisleri için TDD rehberi. Apache Camel ile event-driven mimariler için optimize edilmiştir.

## When to Use

- Yeni özellikler veya REST endpoint'leri
- Bug düzeltmeleri veya refactoring'ler
- Veri erişim mantığı, güvenlik kuralları veya reaktif akışlar ekleme
- Apache Camel route'larını ve event handler'larını test etme
- RabbitMQ ile event-driven servisleri test etme
- Koşullu akış mantığını test etme
- CompletableFuture async işlemlerini doğrulama
- LogContext yayılımını test etme

## How It Works

1. Önce testleri yazın (başarısız olmalılar)
2. Geçmek için minimal kod uygulayın
3. Testleri yeşil tutarken refactor edin
4. JaCoCo ile kapsamı zorlayın (%80+ hedef)

## Examples

### @Nested Organizasyonlu Unit Testler

Kapsamlı ve okunabilir testler için bu yapılandırılmış yaklaşımı izleyin:

```java
@ExtendWith(MockitoExtension.class)
@DisplayName("As2ProcessingService Unit Tests")
class As2ProcessingServiceTest {

  @Mock
  private InvoiceFlowValidator invoiceFlowValidator;

  @Mock
  private EventService eventService;

  @Mock
  private DocumentJobService documentJobService;

  @Mock
  private BusinessRulesPublisher businessRulesPublisher;

  @Mock
  private FileStorageService fileStorageService;

  @InjectMocks
  private As2ProcessingService as2ProcessingService;

  private Path testFilePath;
  private LogContext testLogContext;
  private InvoiceValidationResult validationResult;
  private StoredDocumentInfo documentInfo;

  @BeforeEach
  void setUp() {
    // ARRANGE - Ortak test verisi
    testFilePath = Path.of("/tmp/test-invoice.xml");

    testLogContext = new LogContext();
    testLogContext.put(As2Constants.STRUCTURE_ID, "STRUCT-001");
    testLogContext.put(As2Constants.FILE_NAME, "invoice.xml");
    testLogContext.put(As2Constants.AS2_FROM, "PARTNER-001");

    validationResult = new InvoiceValidationResult();
    validationResult.setValid(true);
    validationResult.setSize(1024L);
    validationResult.setDocumentHash("abc123");

    documentInfo = new StoredDocumentInfo();
    documentInfo.setPath("s3://bucket/path/invoice.xml");
    documentInfo.setSize(1024L);
  }

  @Nested
  @DisplayName("processFile için testler")
  class ProcessFile {

    @Test
    @DisplayName("CHORUS olmayan dosyayı tüm validasyonlarla başarıyla işlemeli")
    void givenNonChorusFile_whenProcessFile_thenAllValidationsApplied() throws Exception {
      // ARRANGE
      testLogContext.put(As2Constants.CHORUS_FLOW, "false");
      CustomLog.setCurrentContext(testLogContext);

      when(invoiceFlowValidator.validateFlowWithConfig(
          eq(testFilePath),
          eq(ValidationFlowConfig.allValidations()),
          eq(EInvoiceSyntaxFormat.UBL),
          any(LogContext.class)))
          .thenReturn(validationResult);

      when(invoiceFlowValidator.computeFlowProfile(any(), any()))
          .thenReturn(FlowProfile.BASIC);

      when(fileStorageService.uploadOriginalFile(any(), anyLong(), any(), any()))
          .thenReturn(CompletableFuture.completedFuture(documentInfo));

      when(documentJobService.createDocumentAndJobEntities(any(), any(), any(), any(), any()))
          .thenReturn(new BusinessRulesPayload());

      // ACT
      assertDoesNotThrow(() -> as2ProcessingService.processFile(testFilePath));

      // ASSERT
      verify(invoiceFlowValidator).validateFlowWithConfig(
          eq(testFilePath),
          eq(ValidationFlowConfig.allValidations()),
          eq(EInvoiceSyntaxFormat.UBL),
          any(LogContext.class));

      verify(eventService).createSuccessEvent(any(StoredDocumentInfo.class),
          eq("PERSISTENCE_BLOB_EVENT_TYPE"));
      verify(eventService).createSuccessEvent(any(BusinessRulesPayload.class),
          eq("BUSINESS_RULES_MESSAGE_SENT"));
      verify(businessRulesPublisher).publishAsync(any(BusinessRulesPayload.class));
    }

    @Test
    @DisplayName("CHORUS_FLOW için schematron validasyonu atlanmalı")
    void givenChorusFlow_whenProcessFile_thenSchematronBypassed() throws Exception {
      // ARRANGE
      testLogContext.put(As2Constants.CHORUS_FLOW, "true");
      CustomLog.setCurrentContext(testLogContext);

      when(invoiceFlowValidator.validateFlowWithConfig(
          eq(testFilePath),
          eq(ValidationFlowConfig.xsdOnly()),
          eq(EInvoiceSyntaxFormat.UBL),
          any(LogContext.class)))
          .thenReturn(validationResult);

      when(fileStorageService.uploadOriginalFile(any(), anyLong(), any(), any()))
          .thenReturn(CompletableFuture.completedFuture(documentInfo));

      when(documentJobService.createDocumentAndJobEntities(any(), any(), any(),
          eq(FlowProfile.EXTENDED_CTC_FR), any()))
          .thenReturn(new BusinessRulesPayload());

      // ACT
      assertDoesNotThrow(() -> as2ProcessingService.processFile(testFilePath));

      // ASSERT
      verify(invoiceFlowValidator).validateFlowWithConfig(
          eq(testFilePath),
          eq(ValidationFlowConfig.xsdOnly()),
          eq(EInvoiceSyntaxFormat.UBL),
          any(LogContext.class));

      verify(documentJobService).createDocumentAndJobEntities(
          any(), any(), any(),
          eq(FlowProfile.EXTENDED_CTC_FR),
          any());
    }

    @Test
    @DisplayName("Dosya yükleme başarısız olduğunda hata eventi oluşturulmalı")
    void givenUploadFailure_whenProcessFile_thenErrorEventCreated() throws Exception {
      // ARRANGE
      testLogContext.put(As2Constants.CHORUS_FLOW, "false");
      CustomLog.setCurrentContext(testLogContext);

      when(invoiceFlowValidator.validateFlowWithConfig(any(), any(), any(), any()))
          .thenReturn(validationResult);

      when(invoiceFlowValidator.computeFlowProfile(any(), any()))
          .thenReturn(FlowProfile.BASIC);

      documentInfo.setPath(""); // Boş path hatayı tetikler
      when(fileStorageService.uploadOriginalFile(any(), anyLong(), any(), any()))
          .thenReturn(CompletableFuture.completedFuture(documentInfo));

      // ACT & ASSERT
      As2ServerProcessingException exception = assertThrows(
          As2ServerProcessingException.class,
          () -> as2ProcessingService.processFile(testFilePath)
      );

      assertThat(exception.getMessage())
          .contains("File path is empty after upload");

      verify(eventService).createErrorEvent(
          eq(documentInfo),
          eq("FILE_UPLOAD_FAILED"),
          contains("File path is empty"));

      verify(businessRulesPublisher, never()).publishAsync(any());
    }

    @Test
    @DisplayName("CompletableFuture.join() başarısızlığı ele alınmalı")
    void givenAsyncUploadFailure_whenProcessFile_thenExceptionThrown() throws Exception {
      // ARRANGE
      testLogContext.put(As2Constants.CHORUS_FLOW, "false");
      CustomLog.setCurrentContext(testLogContext);

      when(invoiceFlowValidator.validateFlowWithConfig(any(), any(), any(), any()))
          .thenReturn(validationResult);

      when(invoiceFlowValidator.computeFlowProfile(any(), any()))
          .thenReturn(FlowProfile.BASIC);

      CompletableFuture<StoredDocumentInfo> failedFuture =
          CompletableFuture.failedFuture(new StorageException("S3 connection failed"));
      when(fileStorageService.uploadOriginalFile(any(), anyLong(), any(), any()))
          .thenReturn(failedFuture);

      // ACT & ASSERT
      assertThrows(
          CompletionException.class,
          () -> as2ProcessingService.processFile(testFilePath)
      );
    }

    @Test
    @DisplayName("Dosya yolu null olduğunda exception fırlatılmalı")
    void givenNullFilePath_whenProcessFile_thenThrowsException() {
      // ARRANGE
      Path nullPath = null;

      // ACT & ASSERT
      NullPointerException exception = assertThrows(
          NullPointerException.class,
          () -> as2ProcessingService.processFile(nullPath)
      );

      verify(invoiceFlowValidator, never()).validateFlowWithConfig(any(), any(), any(), any());
    }
  }
}
```

### Temel Test Desenleri

1. **@Nested Sınıflar**: Testleri test edilen metoda göre gruplandırın
2. **@DisplayName**: Test raporlarında okunabilir açıklamalar sağlayın
3. **İsimlendirme Kuralı**: Netlik için `givenX_whenY_thenZ`
4. **AAA Deseni**: Açık `// ARRANGE`, `// ACT`, `// ASSERT` yorumları
5. **@BeforeEach**: Tekrarı azaltmak için ortak test verisi kurulumu
6. **assertDoesNotThrow**: Exception yakalamadan başarı senaryolarını test edin
7. **assertThrows**: AssertJ kullanarak mesaj doğrulamalı exception senaryolarını test edin
8. **Kapsamlı Kapsam**: Mutlu yolları, null girdileri, edge case'leri, exception'ları test edin
9. **Etkileşimleri Doğrulama**: Metodların doğru çağrıldığından emin olmak için Mockito `verify()` kullanın
10. **Hiçbir Zaman Doğrulama**: Hata senaryolarında metodların ÇAĞRILMADIĞINI sağlamak için `never()` kullanın

## Camel Route Testi

```java
@QuarkusTest
@DisplayName("Business Rules Camel Route Tests")
class BusinessRulesRouteTest {

  @Inject
  CamelContext camelContext;

  @Inject
  ProducerTemplate producerTemplate;

  @InjectMock
  EventService eventService;

  private BusinessRulesPayload testPayload;

  @BeforeEach
  void setUp() {
    // ARRANGE - Test verisi
    testPayload = new BusinessRulesPayload();
    testPayload.setDocumentId(1L);
    testPayload.setFlowProfile(FlowProfile.BASIC);
  }

  @Nested
  @DisplayName("business-rules-publisher route için testler")
  class BusinessRulesPublisher {

    @Test
    @DisplayName("Mesajı başarıyla RabbitMQ'ya yayınlamalı")
    void givenValidPayload_whenPublish_thenMessageSentToQueue() throws Exception {
      // ARRANGE
      MockEndpoint mockRabbitMQ = camelContext.getEndpoint("mock:rabbitmq", MockEndpoint.class);
      mockRabbitMQ.expectedMessageCount(1);

      // Test için gerçek endpoint'i mock ile değiştir
      camelContext.getRouteController().stopRoute("business-rules-publisher");
      AdviceWith.adviceWith(camelContext, "business-rules-publisher", advice -> {
        advice.replaceFromWith("direct:business-rules-publisher");
        advice.weaveByToString(".*spring-rabbitmq.*").replace().to("mock:rabbitmq");
      });
      camelContext.getRouteController().startRoute("business-rules-publisher");

      // ACT
      producerTemplate.sendBody("direct:business-rules-publisher", testPayload);

      // ASSERT — .marshal().json() sonrası body JSON String'dir
      mockRabbitMQ.assertIsSatisfied(5000);

      assertThat(mockRabbitMQ.getExchanges()).hasSize(1);
      String body = mockRabbitMQ.getExchanges().get(0).getIn().getBody(String.class);
      assertThat(body).contains("\"documentId\":1");
    }

    @Test
    @DisplayName("JSON'a marshalling'i ele almalı")
    void givenPayload_whenPublish_thenMarshalledToJson() throws Exception {
      // ARRANGE
      MockEndpoint mockMarshal = new MockEndpoint("mock:marshal");
      camelContext.addEndpoint("mock:marshal", mockMarshal);
      mockMarshal.expectedMessageCount(1);

      camelContext.getRouteController().stopRoute("business-rules-publisher");
      AdviceWith.adviceWith(camelContext, "business-rules-publisher", advice -> {
        advice.weaveAddLast().to("mock:marshal");
      });
      camelContext.getRouteController().startRoute("business-rules-publisher");

      // ACT
      producerTemplate.sendBody("direct:business-rules-publisher", testPayload);

      // ASSERT
      mockMarshal.assertIsSatisfied(5000);

      String body = mockMarshal.getExchanges().get(0).getIn().getBody(String.class);
      assertThat(body).contains("\"documentId\":1");
      assertThat(body).contains("\"flowProfile\":\"BASIC\"");
    }
  }

  @Nested
  @DisplayName("document-processing route için testler")
  class DocumentProcessing {

    @Test
    @DisplayName("Faturayı doğru işlemciye yönlendirmeli")
    void givenInvoiceType_whenProcess_thenRoutesToInvoiceProcessor() throws Exception {
      // ARRANGE
      MockEndpoint mockInvoice = camelContext.getEndpoint("mock:invoice", MockEndpoint.class);
      mockInvoice.expectedMessageCount(1);

      camelContext.getRouteController().stopRoute("document-processing");
      AdviceWith.adviceWith(camelContext, "document-processing", advice -> {
        advice.weaveByToString(".*direct:process-invoice.*").replace().to("mock:invoice");
      });
      camelContext.getRouteController().startRoute("document-processing");

      // ACT
      producerTemplate.sendBodyAndHeader("direct:process-document",
          testPayload, "documentType", "INVOICE");

      // ASSERT
      mockInvoice.assertIsSatisfied(5000);
    }

    @Test
    @DisplayName("Validasyon hatalarını zarif şekilde ele almalı")
    void givenValidationError_whenProcess_thenRoutesToErrorHandler() throws Exception {
      // ARRANGE
      MockEndpoint mockError = camelContext.getEndpoint("mock:error", MockEndpoint.class);
      mockError.expectedMessageCount(1);

      camelContext.getRouteController().stopRoute("document-processing");
      AdviceWith.adviceWith(camelContext, "document-processing", advice -> {
        advice.weaveByToString(".*direct:validation-error-handler.*")
            .replace().to("mock:error");
      });
      camelContext.getRouteController().startRoute("document-processing");

      // Error event oluşturma hatasını gerçek EventService API'si üzerinden simüle et
      doThrow(new ValidationException("Invalid document"))
          .when(eventService)
          .createErrorEvent(any(), eq("VALIDATION_ERROR"), anyString());

      // ACT
      producerTemplate.sendBody("direct:process-document", testPayload);

      // ASSERT
      mockError.assertIsSatisfied(5000);

      Exception exception = mockError.getExchanges().get(0).getException();
      assertThat(exception).isInstanceOf(ValidationException.class);
      assertThat(exception.getMessage()).contains("Invalid document");
    }
  }
}
```

## Event Service Testi

```java
@ExtendWith(MockitoExtension.class)
@DisplayName("EventService Unit Tests")
class EventServiceTest {

  @Mock
  private EventRepository eventRepository;

  @Mock
  private ObjectMapper objectMapper;

  @InjectMocks
  private EventService eventService;

  private BusinessRulesPayload testPayload;

  @BeforeEach
  void setUp() {
    // ARRANGE
    testPayload = new BusinessRulesPayload();
    testPayload.setDocumentId(1L);
  }

  @Nested
  @DisplayName("createSuccessEvent için testler")
  class CreateSuccessEvent {

    @Test
    @DisplayName("Doğru niteliklerle başarı eventi oluşturulmalı")
    void givenValidPayload_whenCreateSuccessEvent_thenEventPersisted() throws Exception {
      // ARRANGE
      when(objectMapper.writeValueAsString(testPayload)).thenReturn("{\"documentId\":1}");

      // ACT
      assertDoesNotThrow(() ->
          eventService.createSuccessEvent(testPayload, "DOCUMENT_PROCESSED"));

      // ASSERT
      verify(eventRepository).persist(argThat(event ->
          event.getType().equals("DOCUMENT_PROCESSED") &&
          event.getStatus() == EventStatus.SUCCESS &&
          event.getPayload().equals("{\"documentId\":1}") &&
          event.getTimestamp() != null
      ));
    }

    @Test
    @DisplayName("Payload null olduğunda exception fırlatılmalı")
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
  @DisplayName("createErrorEvent için testler")
  class CreateErrorEvent {

    @Test
    @DisplayName("Hata mesajıyla hata eventi oluşturulmalı")
    void givenError_whenCreateErrorEvent_thenEventPersistedWithMessage() throws Exception {
      // ARRANGE
      String errorMessage = "Processing failed";
      when(objectMapper.writeValueAsString(testPayload)).thenReturn("{\"documentId\":1}");

      // ACT
      assertDoesNotThrow(() ->
          eventService.createErrorEvent(testPayload, "PROCESSING_ERROR", errorMessage));

      // ASSERT
      verify(eventRepository).persist(argThat(event ->
          event.getType().equals("PROCESSING_ERROR") &&
          event.getStatus() == EventStatus.ERROR &&
          event.getErrorMessage().equals(errorMessage) &&
          event.getPayload().equals("{\"documentId\":1}")
      ));
    }

    @ParameterizedTest
    @DisplayName("Geçersiz hata mesajları reddedilmeli")
    @ValueSource(strings = {"", " "})
    void givenBlankErrorMessage_whenCreateErrorEvent_thenThrowsException(String blankMessage) {
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

## CompletableFuture Testi

```java
@ExtendWith(MockitoExtension.class)
@DisplayName("FileStorageService Unit Tests")
class FileStorageServiceTest {

  @Mock
  private S3Client s3Client;

  @Mock
  private ExecutorService executorService;

  @InjectMocks
  private FileStorageService fileStorageService;

  private InputStream testInputStream;
  private LogContext testLogContext;

  @BeforeEach
  void setUp() {
    // ARRANGE
    testInputStream = new ByteArrayInputStream("test content".getBytes());
    testLogContext = new LogContext();
    testLogContext.put("traceId", "trace-123");
  }

  @Nested
  @DisplayName("uploadOriginalFile için testler")
  class UploadOriginalFile {

    @Test
    @DisplayName("Dosyayı başarıyla yüklemeli ve belge bilgisi döndürmeli")
    void givenValidFile_whenUpload_thenReturnsDocumentInfo() throws Exception {
      // ARRANGE
      doAnswer(invocation -> {
        ((Runnable) invocation.getArgument(0)).run();
        return null;
      }).when(executorService).execute(any(Runnable.class));

      when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
          .thenReturn(PutObjectResponse.builder().build());

      // ACT
      CompletableFuture<StoredDocumentInfo> future =
          fileStorageService.uploadOriginalFile(testInputStream, 1024L,
              testLogContext, InvoiceFormat.UBL);

      StoredDocumentInfo result = future.join();

      // ASSERT
      assertThat(result).isNotNull();
      assertThat(result.getPath()).isNotBlank();
      assertThat(result.getSize()).isEqualTo(1024L);
      assertThat(result.getUploadedAt()).isNotNull();

      verify(s3Client).putObject(any(PutObjectRequest.class), any(RequestBody.class));
    }

    @Test
    @DisplayName("S3 yükleme başarısızlığını ele almalı")
    void givenS3Failure_whenUpload_thenCompletableFutureFails() {
      // ARRANGE
      doAnswer(invocation -> {
        ((Runnable) invocation.getArgument(0)).run();
        return null;
      }).when(executorService).execute(any(Runnable.class));

      when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
          .thenThrow(new StorageException("S3 unavailable"));

      // ACT
      CompletableFuture<StoredDocumentInfo> future =
          fileStorageService.uploadOriginalFile(testInputStream, 1024L,
              testLogContext, InvoiceFormat.UBL);

      // ASSERT
      assertThatThrownBy(() -> future.join())
          .isInstanceOf(CompletionException.class)
          .hasCauseInstanceOf(StorageException.class)
          .hasMessageContaining("S3 unavailable");
    }

    @Test
    @DisplayName("LogContext'i async işleme yaymalı")
    void givenLogContext_whenUpload_thenContextPropagated() throws Exception {
      // ARRANGE
      AtomicReference<LogContext> capturedContext = new AtomicReference<>();

      doAnswer(invocation -> {
        capturedContext.set(CustomLog.getCurrentContext());
        ((Runnable) invocation.getArgument(0)).run();
        return null;
      }).when(executorService).execute(any(Runnable.class));

      // ACT
      fileStorageService.uploadOriginalFile(testInputStream, 1024L,
          testLogContext, InvoiceFormat.UBL).join();

      // ASSERT
      assertThat(capturedContext.get()).isNotNull();
      assertThat(capturedContext.get().get("traceId")).isEqualTo("trace-123");
    }
  }
}
```

## Resource Katmanı Testleri (REST Assured)

```java
@QuarkusTest
@DisplayName("DocumentResource API Tests")
class DocumentResourceTest {

  @InjectMock
  DocumentService documentService;

  @Nested
  @DisplayName("GET /api/documents için testler")
  class ListDocuments {

    @Test
    @DisplayName("Belge listesini döndürmeli")
    void givenDocumentsExist_whenList_thenReturnsOk() {
      // ARRANGE
      List<Document> documents = List.of(createDocument(1L, "DOC-001"));
      when(documentService.list(0, 20)).thenReturn(documents);

      // ACT & ASSERT
      given()
          .when().get("/api/documents")
          .then()
          .statusCode(200)
          .body("$.size()", is(1))
          .body("[0].referenceNumber", equalTo("DOC-001"));
    }
  }

  @Nested
  @DisplayName("POST /api/documents için testler")
  class CreateDocument {

    @Test
    @DisplayName("Belge oluşturmalı ve 201 döndürmeli")
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
                "description": "Test document",
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
    @DisplayName("Geçersiz girdi için 400 döndürmeli")
    void givenInvalidRequest_whenCreate_thenReturns400() {
      // ACT & ASSERT
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

  private Document createDocument(Long id, String referenceNumber) {
    Document document = new Document();
    document.setId(id);
    document.setReferenceNumber(referenceNumber);
    document.setStatus(DocumentStatus.PENDING);
    return document;
  }
}
```

## Gerçek Veritabanıyla Entegrasyon Testleri

```java
@QuarkusTest
@TestProfile(IntegrationTestProfile.class)
@DisplayName("Document Integration Tests")
class DocumentIntegrationTest {

  @Test
  @Transactional
  @DisplayName("Belge oluşturulmalı ve API üzerinden alınabilmeli")
  void givenNewDocument_whenCreateAndRetrieve_thenSuccessful() {
    // ACT - API üzerinden oluştur
    Long id = given()
        .contentType(ContentType.JSON)
        .body("""
            {
              "referenceNumber": "INT-001",
              "description": "Integration test",
              "validUntil": "2030-01-01T00:00:00Z",
              "categories": ["test"]
            }
            """)
        .when().post("/api/documents")
        .then()
        .statusCode(201)
        .extract().path("id");

    // ASSERT - API üzerinden al
    given()
        .when().get("/api/documents/" + id)
        .then()
        .statusCode(200)
        .body("referenceNumber", equalTo("INT-001"));
  }
}
```

## JaCoCo ile Kapsam

### Maven Yapılandırması (Tam)

```xml
<plugin>
  <groupId>org.jacoco</groupId>
  <artifactId>jacoco-maven-plugin</artifactId>
  <version>0.8.13</version>
  <executions>
    <!-- Test yürütmesi için agent'ı hazırla -->
    <execution>
      <id>prepare-agent</id>
      <goals>
        <goal>prepare-agent</goal>
      </goals>
    </execution>

    <!-- Kapsam raporu oluştur -->
    <execution>
      <id>report</id>
      <phase>verify</phase>
      <goals>
        <goal>report</goal>
      </goals>
    </execution>

    <!-- Kapsam eşiklerini zorla -->
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

Kapsam ile testleri çalıştırın:
```bash
mvn clean test
mvn jacoco:report
mvn jacoco:check

# Rapor: target/site/jacoco/index.html
```

## Test Bağımlılıkları

```xml
<dependencies>
    <!-- Quarkus Test -->
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

    <!-- Mockito -->
    <dependency>
        <groupId>org.mockito</groupId>
        <artifactId>mockito-core</artifactId>
        <scope>test</scope>
    </dependency>

    <!-- AssertJ (JUnit assertion'larına tercih edilir) -->
    <dependency>
        <groupId>org.assertj</groupId>
        <artifactId>assertj-core</artifactId>
        <version>3.24.2</version>
        <scope>test</scope>
    </dependency>

    <!-- REST Assured -->
    <dependency>
        <groupId>io.rest-assured</groupId>
        <artifactId>rest-assured</artifactId>
        <scope>test</scope>
    </dependency>

    <!-- Camel Test -->
    <dependency>
        <groupId>org.apache.camel.quarkus</groupId>
        <artifactId>camel-quarkus-junit5</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
```

## En İyi Uygulamalar

### Test Organizasyonu
- Testleri test edilen metoda göre gruplandırmak için `@Nested` sınıflar kullanın
- Raporlarda görünür okunabilir açıklamalar için `@DisplayName` kullanın
- Test metodları için `givenX_whenY_thenZ` isimlendirme kuralını izleyin
- Tekrarı azaltmak için ortak test verisi kurulumunda `@BeforeEach` kullanın

### Test Yapısı
- Açık yorumlarla AAA desenini izleyin (`// ARRANGE`, `// ACT`, `// ASSERT`)
- Başarı senaryoları için `assertDoesNotThrow` kullanın
- Mesaj doğrulamalı exception senaryoları için `assertThrows` kullanın
- AssertJ `contains()` veya `isEqualTo()` kullanarak exception mesajlarının beklenen değerlerle eşleştiğini doğrulayın

### Test Kapsamı
- Tüm public metodlar için mutlu yolları test edin
- Null girdi işlemeyi test edin
- Edge case'leri test edin (boş koleksiyonlar, sınır değerleri, negatif ID'ler, boş string'ler)
- Exception senaryolarını kapsamlı biçimde test edin
- Tüm harici bağımlılıkları mock'layın (repository'ler, servisler, Camel endpoint'leri)
- %80+ satır kapsamı, %70+ branch kapsamı hedefleyin

### Assertion'lar
- Değer kontrolleri için JUnit assertion'ları yerine **AssertJ'yi tercih edin** (`assertThat`)
- Okunabilirlik için akıcı AssertJ API'si kullanın: `assertThat(list).hasSize(3).contains(item)`
- Exception'lar için: JUnit `assertThrows` ile yakalayın, ardından AssertJ ile mesajı doğrulayın
- Fırlatılmayan başarı yolları için: JUnit `assertDoesNotThrow` kullanın
- Koleksiyonlar için: `extracting()`, `filteredOn()`, `containsExactly()`

### Entegrasyon Testi
- Entegrasyon testleri için `@QuarkusTest` kullanın
- Quarkus testlerinde bağımlılıkları mock'lamak için `@InjectMock` kullanın
- API testi için REST Assured'ı tercih edin
- Test'e özel yapılandırma için `@TestProfile` kullanın

### Event-Driven Test
- `AdviceWith` ve `MockEndpoint` ile Camel route'larını test edin
- `@CamelQuarkusTest` annotasyonu kullanın (bağımsız Camel testleri kullanıyorsanız)
- Mesaj içeriğini, başlıklarını ve yönlendirme mantığını doğrulayın
- Hata işleme route'larını ayrı ayrı test edin
- Unit testlerde harici sistemleri (RabbitMQ, S3, veritabanları) mock'layın

### Camel Route Testi
- Mesaj akışını doğrulamak için `MockEndpoint` kullanın
- Test için route'ları değiştirmek üzere `AdviceWith` kullanın (endpoint'leri mock'larla değiştirin)
- Mesaj dönüşümünü ve marshalling'i test edin
- Exception işleme ve dead letter queue'ları test edin

### Async İşlem Testi
- CompletableFuture başarı ve başarısızlık senaryolarını test edin
- Async tamamlanmayı beklemek için testlerde `.join()` kullanın
- CompletableFuture'dan exception yayılımını test edin
- LogContext yayılımını async işlemlere doğrulayın

### Performans
- Testleri hızlı ve izole tutun
- Testleri sürekli modda çalıştırın: `mvn quarkus:test`
- Girdi varyasyonları için parametreli testler (`@ParameterizedTest`) kullanın
- Yeniden kullanılabilir test verisi builder'ları veya factory metodları oluşturun

### Quarkus'a Özgü
- En son LTS sürümünde kalın (Quarkus 3.x)
- Native derleme uyumluluğunu periyodik olarak test edin
- Farklı senaryolar için Quarkus test profillerini kullanın
- Yerel test için Quarkus dev servislerinden yararlanın
- `@MockBean` yerine `@InjectMock` kullanın (Quarkus'a özgü)

### Doğrulama En İyi Uygulamaları
- Mock'lanmış bağımlılıklardaki etkileşimleri her zaman doğrulayın
- Hata senaryolarında metodların ÇAĞRILMADIĞINI sağlamak için `verify(mock, never())` kullanın
- Karmaşık argüman eşleştirme için `argThat()` kullanın
- Önem taşıdığında çağrı sırasını doğrulayın: Mockito'dan `InOrder`
