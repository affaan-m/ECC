---
name: springboot-patterns
description: Spring Boot architecture patterns, REST API design, layered services, data access, caching, async processing, and logging. Use for Java Spring Boot backend work.
---

# Spring Boot 開発パターン

スケーラブルで本番グレードのサービスのためのSpring BootアーキテクチャとAPIパターン。

## REST API構造

```java
@RestController
@RequestMapping("/api/markets")
@Validated
class MarketController {
  private final MarketService marketService;

  MarketController(MarketService marketService) {
    this.marketService = marketService;
  }

  @GetMapping
  ResponseEntity<Page<MarketResponse>> list(
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    Page<Market> markets = marketService.list(PageRequest.of(page, size));
    return ResponseEntity.ok(markets.map(MarketResponse::from));
  }

  @PostMapping
  ResponseEntity<MarketResponse> create(@Valid @RequestBody CreateMarketRequest request) {
    Market market = marketService.create(request);
    return ResponseEntity.status(HttpStatus.CREATED).body(MarketResponse::from(market));
  }
}
```

## リポジトリパターン（Spring Data JPA）

```java
public interface MarketRepository extends JpaRepository<MarketEntity, Long> {
  @Query("select m from MarketEntity m where m.status = :status order by m.volume desc")
  List<MarketEntity> findActive(@Param("status") MarketStatus status, Pageable pageable);
}
```

## トランザクション付きサービスレイヤー

```java
@Service
public class MarketService {
  private final MarketRepository repo;

  public MarketService(MarketRepository repo) {
    this.repo = repo;
  }

  @Transactional
  public Market create(CreateMarketRequest request) {
    MarketEntity entity = MarketEntity.from(request);
    MarketEntity saved = repo.save(entity);
    return Market.from(saved);
  }
}
```

## DTOと検証

```java
public record CreateMarketRequest(
    @NotBlank @Size(max = 200) String name,
    @NotBlank @Size(max = 2000) String description,
    @NotNull @FutureOrPresent Instant endDate,
    @NotEmpty List<@NotBlank String> categories) {}

public record MarketResponse(Long id, String name, MarketStatus status) {
  static MarketResponse from(Market market) {
    return new MarketResponse(market.id(), market.name(), market.status());
  }
}
```

## 例外ハンドリング

```java
@ControllerAdvice
class GlobalExceptionHandler {
  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex) {
    String message = ex.getBindingResult().getFieldErrors().stream()
        .map(e -> e.getField() + ": " + e.getDefaultMessage())
        .collect(Collectors.joining(", "));
    return ResponseEntity.badRequest().body(ApiError.validation(message));
  }

  @ExceptionHandler(AccessDeniedException.class)
  ResponseEntity<ApiError> handleAccessDenied() {
    return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiError.of("Forbidden"));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<ApiError> handleGeneric(Exception ex) {
    // スタックトレース付きで予期しないエラーをログ
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(ApiError.of("Internal server error"));
  }
}
```

## キャッシング

構成クラスで`@EnableCaching`が必要です。

```java
@Service
public class MarketCacheService {
  private final MarketRepository repo;

  public MarketCacheService(MarketRepository repo) {
    this.repo = repo;
  }

  @Cacheable(value = "market", key = "#id")
  public Market getById(Long id) {
    return repo.findById(id)
        .map(Market::from)
        .orElseThrow(() -> new EntityNotFoundException("Market not found"));
  }

  @CacheEvict(value = "market", key = "#id")
  public void evict(Long id) {}
}
```

## 非同期処理

構成クラスで`@EnableAsync`が必要です。

```java
@Service
public class NotificationService {
  @Async
  public CompletableFuture<Void> sendAsync(Notification notification) {
    // メール/SMS送信
    return CompletableFuture.completedFuture(null);
  }
}
```

## ロギング（SLF4J）

```java
@Service
public class ReportService {
  private static final Logger log = LoggerFactory.getLogger(ReportService.class);

  public Report generate(Long marketId) {
    log.info("generate_report marketId={}", marketId);
    try {
      // ロジック
    } catch (Exception ex) {
      log.error("generate_report_failed marketId={}", marketId, ex);
      throw ex;
    }
    return new Report();
  }
}
```

## ミドルウェア / フィルター

```java
@Component
public class RequestLoggingFilter extends OncePerRequestFilter {
  private static final Logger log = LoggerFactory.getLogger(RequestLoggingFilter.class);

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
      FilterChain filterChain) throws ServletException, IOException {
    long start = System.currentTimeMillis();
    try {
      filterChain.doFilter(request, response);
    } finally {
      long duration = System.currentTimeMillis() - start;
      log.info("req method={} uri={} status={} durationMs={}",
          request.getMethod(), request.getRequestURI(), response.getStatus(), duration);
    }
  }
}
```

## ページネーションとソート

```java
PageRequest page = PageRequest.of(pageNumber, pageSize, Sort.by("createdAt").descending());
Page<Market> results = marketService.list(page);
```

## エラー回復力のある外部呼び出し

```java
public <T> T withRetry(Supplier<T> supplier, int maxRetries) {
  int attempts = 0;
  while (true) {
    try {
      return supplier.get();
    } catch (Exception ex) {
      attempts++;
      if (attempts >= maxRetries) {
        throw ex;
      }
      try {
        Thread.sleep((long) Math.pow(2, attempts) * 100L);
      } catch (InterruptedException ie) {
        Thread.currentThread().interrupt();
        throw ex;
      }
    }
  }
}
```

## レート制限（Filter + Bucket4j）

**セキュリティノート**: `X-Forwarded-For`ヘッダーはデフォルトでは信頼できません。クライアントがそれを偽装できるためです。
転送ヘッダーは次の場合のみ使用してください:
1. アプリが信頼できるリバースプロキシ（nginx、AWS ALBなど）の背後にある
2. `ForwardedHeaderFilter`をBeanとして登録済み
3. application propertiesで`server.forward-headers-strategy=NATIVE`または`FRAMEWORK`を設定済み
4. プロキシが`X-Forwarded-For`ヘッダーを上書き（追加ではなく）するよう設定済み

`ForwardedHeaderFilter`が適切に構成されている場合、`request.getRemoteAddr()`は転送ヘッダーから正しいクライアントIPを自動的に返します。この構成がない場合は、`request.getRemoteAddr()`を直接使用してください。これは直接接続IPを返し、唯一信頼できる値です。

```java
@Component
public class RateLimitFilter extends OncePerRequestFilter {
  private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

  /*
   * セキュリティ: このフィルターはレート制限のためにクライアントを識別するために
   * request.getRemoteAddr()を使用します。
   *
   * アプリケーションがリバースプロキシ（nginx、AWS ALBなど）の背後にある場合、
   * 正確なクライアントIP検出のために転送ヘッダーを適切に処理するようSpringを
   * 設定する必要があります:
   *
   * 1. application.properties/yamlで server.forward-headers-strategy=NATIVE
   *    （クラウドプラットフォーム用）またはFRAMEWORKを設定
   * 2. FRAMEWORK戦略を使用する場合、ForwardedHeaderFilterを登録:
   *
   *    @Bean
   *    ForwardedHeaderFilter forwardedHeaderFilter() {
   *        return new ForwardedHeaderFilter();
   *    }
   *
   * 3. プロキシが偽装を防ぐためにX-Forwarded-Forヘッダーを上書き（追加ではなく）
   *    することを確認
   * 4. コンテナに応じてserver.tomcat.remoteip.trusted-proxiesまたは同等を設定
   *
   * この構成なしでは、request.getRemoteAddr()はクライアントIPではなくプロキシIPを返します。
   * X-Forwarded-Forを直接読み取らないでください。信頼できるプロキシ処理なしでは簡単に偽装できます。
   */
  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
      FilterChain filterChain) throws ServletException, IOException {
    // ForwardedHeaderFilterが構成されている場合は正しいクライアントIPを返す
    // getRemoteAddr()を使用。そうでなければ直接接続IPを返す。
    // X-Forwarded-Forヘッダーを適切なプロキシ構成なしで直接信頼しない。
    String clientIp = request.getRemoteAddr();

    Bucket bucket = buckets.computeIfAbsent(clientIp,
        k -> Bucket.builder()
            .addLimit(Bandwidth.classic(100, Refill.greedy(100, Duration.ofMinutes(1))))
            .build());

    if (bucket.tryConsume(1)) {
      filterChain.doFilter(request, response);
    } else {
      response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
    }
  }
}
```

## バックグラウンドジョブ

Springの`@Scheduled`を使用するか、キュー（Kafka、SQS、RabbitMQなど）と統合します。ハンドラーをべき等かつ観測可能に保ちます。

## 可観測性

- 構造化ロギング（JSON）via Logbackエンコーダー
- メトリクス: Micrometer + Prometheus/OTel
- トレーシング: Micrometer TracingとOpenTelemetryまたはBraveバックエンド

## 本番デフォルト

- コンストラクタインジェクションを優先、フィールドインジェクションを避ける
- RFC 7807エラーのために`spring.mvc.problemdetails.enabled=true`を有効化（Spring Boot 3+）
- ワークロードに応じてHikariCPプールサイズを構成、タイムアウトを設定
- クエリに`@Transactional(readOnly = true)`を使用
- `@NonNull`と`Optional`で適切にnull安全性を強制

**覚えておいてください**: コントローラーは薄く、サービスは焦点を絞り、リポジトリはシンプルに、エラーは集中的に処理します。保守性とテスト可能性のために最適化してください。
