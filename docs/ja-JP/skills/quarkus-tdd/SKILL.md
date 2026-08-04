---
name: quarkus-tdd
description: JUnit 5、Mockito、REST Assured、Camelテスト、JaCoCoを使用したQuarkus 3.xのテスト駆動開発。機能追加、バグ修正、またはイベント駆動サービスのリファクタリング時に使用。
origin: ECC
---

# Quarkus TDD Workflow

80%以上のカバレッジ（ユニット+統合）を備えたQuarkus 3.xサービスのTDD指導。Apache Camelを使用したイベント駆動アーキテクチャに最適化。

## When to Use

- 新機能またはRESTエンドポイント
- バグ修正またはリファクタリング
- データアクセスロジック、セキュリティルール、またはリアクティブストリーム追加
- Apache Camelルートとイベントハンドラーテスト
- RabbitMQを使用したイベント駆動サービステスト
- 条件フローロジック検証
- CompletableFuture非同期操作検証
- LogContextプロパゲーション テスト

## Workflow

1. テストを先に書く（失敗するはず）
2. 最小限のコードで合格実装
3. テストが緑の状態でリファクタリング
4. JaCoCoでカバレッジ実装（80%以上を目標）

## Unit Tests with @Nested Organization

包括的で読みやすいテストのため、以下の構造化されたアプローチに従います：

```java
@ExtendWith(MockitoExtension.class)
@DisplayName("OrderService Unit Tests")
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
  @DisplayName("createOrder のテスト")
  class CreateOrder {

    @Test
    @DisplayName("有効なコマンドが与えられた場合、注文を永続化してフルフィルメントイベントを発行する")
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
    @DisplayName("顧客IDが無い場合、BadRequestをスロー")
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
    @DisplayName("永続化失敗時、エラーイベントを記録")
    void givenPersistenceFailure_whenCreateOrder_thenRecordsErrorEvent() {
      // ARRANGE
      doThrow(new PersistenceException("database unavailable"))
          .when(orderRepository).persist(any(Order.class));

      // ACT & ASSERT
      PersistenceException exception = assertThrows(
          PersistenceException.class,
          () -> orderService.createOrder(validCommand)
      );

      assertThat(exception.getMessage()).contains("database unavailable");
      verify(eventService).createErrorEvent(
          eq(validCommand),
          eq("ORDER_CREATE_FAILED"),
          contains("database unavailable")
      );
      verify(fulfillmentPublisher, never()).publishAsync(any());
    }

    @Test
    @DisplayName("nullコマンドが与えられた場合、NullPointerExceptionをスロー")
    void givenNullCommand_whenCreateOrder_thenThrowsNullPointerException() {
      // ACT & ASSERT
      assertThrows(
          NullPointerException.class,
          () -> orderService.createOrder(null)
      );

      verify(orderRepository, never()).persist(any(Order.class));
    }
  }
}
```

### Key Testing Patterns

1. **@Nested クラス**: テストするメソッド別にテストをグループ化
2. **@DisplayName**: テストレポート用の読みやすい説明提供
3. **命名規則**: 明確性のため `givenX_whenY_thenZ`
4. **AAA パターン**: 明示的な `// ARRANGE`, `// ACT`, `// ASSERT` コメント
5. **@BeforeEach**: 重複削減のためテストデータを共通設定
6. **assertDoesNotThrow**: 例外をキャッチせずに成功シナリオをテスト
7. **assertThrows**: AssertJを使用したメッセージ検証で例外シナリオをテスト
8. **包括的カバレッジ**: 正常系、null入力、エッジケース、例外をテスト
9. **相互作用検証**: Mockito `verify()` でメソッド呼び出しが正しく行われたか確認
10. **Never検証**: `never()` でエラーシナリオでメソッドが呼ばれていないことを確認

## Testing Camel Routes

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

  @InjectMock
  DocumentValidator documentValidator;

  private BusinessRulesPayload testPayload;

  @BeforeEach
  void setUp() {
    // ARRANGE - テストデータ
    testPayload = new BusinessRulesPayload();
    testPayload.setDocumentId(1L);
    testPayload.setFlowProfile(FlowProfile.BASIC);
  }

  @Nested
  @DisplayName("business-rules-publisher ルートのテスト")
  class BusinessRulesPublisher {

    @Test
    @DisplayName("有効なペイロードが与えられた場合、メッセージをRabbitMQに送信")
    void givenValidPayload_whenPublish_thenMessageSentToQueue() throws Exception {
      // ARRANGE
      MockEndpoint mockRabbitMQ = camelContext.getEndpoint("mock:rabbitmq", MockEndpoint.class);
      mockRabbitMQ.expectedMessageCount(1);

      // テスト用の実エンドポイントをモックに置き換え
      camelContext.getRouteController().stopRoute("business-rules-publisher");
      AdviceWith.adviceWith(camelContext, "business-rules-publisher", advice -> {
        advice.replaceFromWith("direct:business-rules-publisher");
        advice.weaveByToString(".*spring-rabbitmq.*").replace().to("mock:rabbitmq");
      });
      camelContext.getRouteController().startRoute("business-rules-publisher");

      // ACT
      producerTemplate.sendBody("direct:business-rules-publisher", testPayload);

      // ASSERT — .marshal().json(JsonLibrary.Jackson)の後、bodyはJSON文字列
      mockRabbitMQ.assertIsSatisfied(5000);

      assertThat(mockRabbitMQ.getExchanges()).hasSize(1);
      String body = mockRabbitMQ.getExchanges().get(0).getIn().getBody(String.class);
      assertThat(body).contains("\"documentId\":1");
    }

    @Test
    @DisplayName("ペイロード与えられた場合、JSONに整形")
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
  @DisplayName("document-processing ルートのテスト")
  class DocumentProcessing {

    @Test
    @DisplayName("請求書タイプが与えられた場合、正しいプロセッサーにルーティング")
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
    @DisplayName("検証エラーが与えられた場合、エラーハンドラーにルーティング")
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

      // バリデータビーンをモック化して例外をスロー
      when(documentValidator.validate(any())).thenThrow(new ValidationException("Invalid document"));

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

## Testing Event Services

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
  @DisplayName("createSuccessEvent のテスト")
  class CreateSuccessEvent {

    @Test
    @DisplayName("有効なペイロードが与えられた場合、正しい属性でサクセスイベント作成")
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
    @DisplayName("nullペイロードが与えられた場合、例外をスロー")
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
  @DisplayName("createErrorEvent のテスト")
  class CreateErrorEvent {

    @Test
    @DisplayName("エラーが与えられた場合、エラーメッセージ付きエラーイベント作成")
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
    @DisplayName("不正なエラーメッセージが与えられた場合、例外をスロー")
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

## Testing CompletableFuture

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
  @DisplayName("uploadOriginalFile のテスト")
  class UploadOriginalFile {

    @Test
    @DisplayName("有効なファイルが与えられた場合、ファイルアップロード成功とドキュメント情報を返す")
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
    @DisplayName("S3アップロード失敗が与えられた場合、CompletableFutureが失敗")
    void givenS3Failure_whenUpload_thenCompletableFutureFails() {
      // ARRANGE — 例外がfutureを通じてプロパゲートされるように同期実行
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
    @DisplayName("LogContextが与えられた場合、非同期操作にコンテキストをプロパゲート")
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

## Resource Layer Tests (REST Assured)

```java
@QuarkusTest
@DisplayName("DocumentResource API Tests")
class DocumentResourceTest {

  @InjectMock
  DocumentService documentService;

  @Nested
  @DisplayName("GET /api/documents のテスト")
  class ListDocuments {

    @Test
    @DisplayName("ドキュメントが存在する場合、ドキュメント一覧を返す")
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
  @DisplayName("POST /api/documents のテスト")
  class CreateDocument {

    @Test
    @DisplayName("有効なリクエストが与えられた場合、ドキュメント作成して201を返す")
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
    @DisplayName("不正なリクエストが与えられた場合、400を返す")
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

## Integration Tests with Real Database

```java
@QuarkusTest
@TestProfile(IntegrationTestProfile.class)
@DisplayName("Document Integration Tests")
class DocumentIntegrationTest {

  @Test
  @Transactional
  @DisplayName("新規ドキュメントをAPIで作成・取得、成功する")
  void givenNewDocument_whenCreateAndRetrieve_thenSuccessful() {
    // ACT - APIで作成
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

    // ASSERT - APIで取得
    given()
        .when().get("/api/documents/" + id)
        .then()
        .statusCode(200)
        .body("referenceNumber", equalTo("INT-001"));
  }
}
```

## Coverage with JaCoCo

### Maven Configuration (Complete)

```xml
<plugin>
  <groupId>org.jacoco</groupId>
  <artifactId>jacoco-maven-plugin</artifactId>
  <version>0.8.13</version>
  <executions>
    <!-- テスト実行用エージェント準備 -->
    <execution>
      <id>prepare-agent</id>
      <goals>
        <goal>prepare-agent</goal>
      </goals>
    </execution>

    <!-- カバレッジレポート生成 -->
    <execution>
      <id>report</id>
      <phase>verify</phase>
      <goals>
        <goal>report</goal>
      </goals>
    </execution>

    <!-- カバレッジ閾値を強制 -->
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

カバレッジ付きテスト実行:
```bash
mvn clean test
mvn jacoco:report
mvn jacoco:check

# レポート: target/site/jacoco/index.html
```

## Test Dependencies

```xml
<dependencies>
    <!-- Quarkus Testing -->
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

    <!-- AssertJ（JUnitアサーション推奨） -->
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

    <!-- Camel Testing -->
    <dependency>
        <groupId>org.apache.camel.quarkus</groupId>
        <artifactId>camel-quarkus-junit5</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
```

## Best Practices

### テスト組織
- テストするメソッド別にグループ化するため`@Nested`クラス使用
- レポートで見やすいテスト説明のため`@DisplayName`使用
- テストメソッド命名は`givenX_whenY_thenZ`規則に従う
- 重複削減のため@BeforeEachで共通テストデータ設定

### テスト構造
- 明示的コメント（`// ARRANGE`, `// ACT`, `// ASSERT`）でAAAパターン従う
- 成功シナリオでは`assertDoesNotThrow`使用
- 例外シナリオではメッセージ検証と共に`assertThrows`使用
- AssertJ `contains()`または`isEqualTo()`で例外メッセージ検証

### テストカバレッジ
- 全パブリックメソッドの正常系パスをテスト
- null入力ハンドリングテスト
- エッジケース（空のコレクション、境界値、負のID、空文字列）テスト
- 例外シナリオを包括的にテスト
- 外部依存関係（リポジトリ、サービス、Camelエンドポイント）をモック化
- 80%以上の行カバレッジ、70%以上のブランチカバレッジ目指す

### アサーション
- **AssertJ推奨**（JUnitアサーション代わりに`assertThat`使用）
- 読みやすさのため流暢なAssertJ API使用：`assertThat(list).hasSize(3).contains(item)`
- 例外は、JUnit `assertThrows`でキャプチャ、AssertJでメッセージ検証
- 非スロー成功パスはJUnit `assertDoesNotThrow`使用
- コレクションには`extracting()`, `filteredOn()`, `containsExactly()`使用

### 統合テスト
- 統合テスト用に`@QuarkusTest`使用
- Quarkusテストの依存関係モック化に`@InjectMock`使用
- APIテストに REST Assured優先使用
- テスト固有設定に`@TestProfile`使用

### イベント駆動テスト
- `AdviceWith`と`MockEndpoint`でCamelルートテスト
- 必要に応じて`@CamelQuarkusTest`注釈使用（スタンドアロンCamelテスト）
- メッセージ内容、ヘッダー、ルーティングロジック検証
- エラーハンドリングルートを別個にテスト
- ユニットテストで外部システム（RabbitMQ、S3、データベース）をモック化

### Camel ルートテスト
- メッセージフロー確認に`MockEndpoint`使用
- テスト用ルート変更にエンドポイントをモックに置き換える`AdviceWith`使用
- メッセージ変換と整形テスト
- 例外処理とデッドレターキューテスト

### 非同期操作テスト
- CompletableFutureの成功・失敗シナリオテスト
- 非同期完了待機に`.join()`使用
- CompletableFutureから例外プロパゲーション検証
- 非同期操作へのLogContextプロパゲーション検証

### パフォーマンス
- テストを高速で分離した状態に保つ
- 継続モードでテスト実行：`mvn quarkus:test`
- 入力バリエーション用に パラメータ化テスト（`@ParameterizedTest`）使用
- 再利用可能なテストデータビルダーまたはファクトリメソッド構築

### Quarkus固有
- 最新LTSバージョン（Quarkus 3.x）に留める
- 定期的にネイティブコンパイル互換性テスト
- 異なるシナリオでQuarkusテストプロファイル活用
- ローカルテストにQuarkus dev サービス活用
- `@MockBean`代わりに`@InjectMock`（Quarkus固有）使用

### 検証ベストプラクティス
- モック化された依存関係の相互作用は常に検証
- エラーシナリオでメソッドが呼ばれていないことを確認するに`verify(mock, never())`使用
- 複雑な引数マッチングに`argThat()`使用
- 呼び出し順序が重要な場合`InOrder`（Mockitoから）で検証
