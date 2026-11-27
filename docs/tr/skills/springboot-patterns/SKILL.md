---
name: springboot-patterns
description: Spring Boot architecture patterns, REST API design, layered services, data access, caching, async processing, and logging. Use for Java Spring Boot backend work.
origin: ECC
---

# Spring Boot Geliştirme Desenleri

Ölçeklenebilir, üretim seviyesi servisler için Spring Boot mimari ve API desenleri.

## Ne Zaman Aktif Edilir

- Spring MVC veya WebFlux ile REST API'leri oluşturma
- Controller → service → repository katmanlarını yapılandırma
- Spring Data JPA, caching veya async processing'i yapılandırma
- Validation, exception handling veya sayfalama ekleme
- Dev/staging/production ortamları için profiller kurma
- Spring Events veya Kafka ile event-driven desenler uygulama

## REST API Yapısı

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

## Repository Deseni (Spring Data JPA)

```java
public interface MarketRepository extends JpaRepository<MarketEntity, Long> {
  @Query("select m from MarketEntity m where m.status = :status order by m.volume desc")
  List<MarketEntity> findActive(@Param("status") MarketStatus status, Pageable pageable);
}
```

## Transaction'lı Service Katmanı

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

## DTO'lar ve Validation

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

## Exception Handling

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
    // Beklenmeyen hataları stack trace'ler ile loglayın
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(ApiError.of("Internal server error"));
  }
}
```

## Caching

Bir configuration sınıfında `@EnableCaching` gerektirir.

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

## Async Processing

Bir configuration sınıfında `@EnableAsync` gerektirir.

```java
@Service
public class NotificationService {
  @Async
  public CompletableFuture<Void> sendAsync(Notification notification) {
    // email/SMS gönder
    return CompletableFuture.completedFuture(null);
  }
}
```

## Loglama (SLF4J)

```java
@Service
public class ReportService {
  private static final Logger log = LoggerFactory.getLogger(ReportService.class);

  public Report generate(Long marketId) {
    log.info("generate_report marketId={}", marketId);
    try {
      // mantık
    } catch (Exception ex) {
      log.error("generate_report_failed marketId={}", marketId, ex);
      throw ex;
    }
    return new Report();
  }
}
```

## Middleware / Filter'lar

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

## Sayfalama ve Sıralama

```java
PageRequest page = PageRequest.of(pageNumber, pageSize, Sort.by("createdAt").descending());
Page<Market> results = marketService.list(page);
```

## Hata-Dayanıklı Harici Çağrılar

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

## Rate Limiting (Filter + Bucket4j)

**Güvenlik Notu**: `X-Forwarded-For` başlığı varsayılan olarak güvenilmezdir çünkü istemciler onu taklit edebilir.
Forwarded başlıkları sadece şu durumlarda kullanın:
1. Uygulamanız güvenilir bir reverse proxy'nin arkasında (nginx, AWS ALB, vb.)
2. `ForwardedHeaderFilter`'ı bean olarak kaydetmişsiniz
3. application properties'de `server.forward-headers-strategy=NATIVE` veya `FRAMEWORK` yapılandırmışsınız
4. Proxy'niz `X-Forwarded-For` başlığını üzerine yazmak için yapılandırılmış (eklememek için değil)

`ForwardedHeaderFilter` düzgün yapılandırıldığında, `request.getRemoteAddr()` otomatik olarak
forwarded başlıklardan doğru istemci IP'sini döndürür. Bu yapılandırma olmadan, `request.getRemoteAddr()` doğrudan kullanın—anlık bağlantı IP'sini döndürür, bu güvenilir tek değerdir.

```java
@Component
public class RateLimitFilter extends OncePerRequestFilter {
  private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

  /*
   * GÜVENLİK: Bu filtre rate limiting için istemcileri tanımlamak üzere request.getRemoteAddr() kullanır.
   *
   * Uygulamanız bir reverse proxy'nin (nginx, AWS ALB, vb.) arkasındaysa, doğru istemci IP tespiti için
   * Spring'i forwarded başlıkları düzgün işleyecek şekilde yapılandırmalısınız:
   *
   * 1. application.properties/yaml'da server.forward-headers-strategy=NATIVE (cloud platformlar için)
   *    veya FRAMEWORK ayarlayın
   * 2. FRAMEWORK stratejisi kullanıyorsanız, ForwardedHeaderFilter'ı kaydedin:
   *
   *    @Bean
   *    ForwardedHeaderFilter forwardedHeaderFilter() {
   *        return new ForwardedHeaderFilter();
   *    }
   *
   * 3. Proxy'nizin sahteciliği önlemek için X-Forwarded-For başlığını üzerine yazdığından emin olun (eklemediğinden)
   * 4. Container'ınız için server.tomcat.remoteip.trusted-proxies veya eşdeğerini yapılandırın
   *
   * Bu yapılandırma olmadan, request.getRemoteAddr() istemci IP'si değil proxy IP'si döndürür.
   * X-Forwarded-For'u doğrudan okumayın—güvenilir proxy işleme olmadan kolayca taklit edilebilir.
   */
  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
      FilterChain filterChain) throws ServletException, IOException {
    // ForwardedHeaderFilter yapılandırıldığında doğru istemci IP'sini döndüren
    // veya aksi halde doğrudan bağlantı IP'sini döndüren getRemoteAddr() kullanın. X-Forwarded-For
    // başlıklarına doğrudan güvenmeyin, düzgun proxy yapılandırması olmadan.
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

## Arka Plan Job'ları

Spring'in `@Scheduled`'ını kullanın veya kuyruklar ile entegre olun (örn. Kafka, SQS, RabbitMQ). Handler'ları idempotent ve gözlemlenebilir tutun.

## Gözlemlenebilirlik

- Logback encoder ile yapılandırılmış loglama (JSON)
- Metrikler: Micrometer + Prometheus/OTel
- Tracing: OpenTelemetry veya Brave backend ile Micrometer Tracing

## Production Varsayılanları

- Constructor injection'ı tercih edin, field injection'dan kaçının
- RFC 7807 hataları için `spring.mvc.problemdetails.enabled=true` etkinleştirin (Spring Boot 3+)
- İş yükü için HikariCP pool boyutlarını yapılandırın, timeout'ları ayarlayın
- Sorgular için `@Transactional(readOnly = true)` kullanın
- `@NonNull` ve uygun yerlerde `Optional` ile null-safety zorlayın

**Unutmayın**: Controller'ları ince, servisleri odaklı, repository'leri basit ve hataları merkezi olarak işlenmiş tutun. Bakım yapılabilirlik ve test edilebilirlik için optimize edin.
