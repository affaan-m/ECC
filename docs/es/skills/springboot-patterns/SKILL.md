---
name: springboot-patterns
description: Patrones de arquitectura Spring Boot, diseño de API REST, servicios en capas, acceso a datos, caché, procesamiento asíncrono y logging. Usar para trabajo de backend en Java con Spring Boot.
origin: ECC
---

# Patrones de Desarrollo Spring Boot

Patrones de arquitectura y API de Spring Boot para servicios escalables y listos para producción.

## Cuándo Activar

- Construir APIs REST con Spring MVC o WebFlux
- Estructurar capas controller → service → repository
- Configurar Spring Data JPA, caché o procesamiento asíncrono
- Agregar validación, manejo de excepciones o paginación
- Configurar perfiles para entornos dev/staging/producción
- Implementar patrones orientados a eventos con Spring Events o Kafka

## Estructura de API REST

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
    return ResponseEntity.status(HttpStatus.CREATED).body(MarketResponse.from(market));
  }
}
```

## Patrón de Repositorio (Spring Data JPA)

```java
public interface MarketRepository extends JpaRepository<MarketEntity, Long> {
  @Query("select m from MarketEntity m where m.status = :status order by m.volume desc")
  List<MarketEntity> findActive(@Param("status") MarketStatus status, Pageable pageable);
}
```

## Capa de Servicio con Transacciones

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

## DTOs y Validación

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

## Manejo de Excepciones

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
    // Registrar errores inesperados con stack traces
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(ApiError.of("Internal server error"));
  }
}
```

## Caché

Requiere `@EnableCaching` en una clase de configuración.

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

## Procesamiento Asíncrono

Requiere `@EnableAsync` en una clase de configuración.

```java
@Service
public class NotificationService {
  @Async
  public CompletableFuture<Void> sendAsync(Notification notification) {
    // enviar email/SMS
    return CompletableFuture.completedFuture(null);
  }
}
```

## Logging (SLF4J)

```java
@Service
public class ReportService {
  private static final Logger log = LoggerFactory.getLogger(ReportService.class);

  public Report generate(Long marketId) {
    log.info("generate_report marketId={}", marketId);
    try {
      // lógica
    } catch (Exception ex) {
      log.error("generate_report_failed marketId={}", marketId, ex);
      throw ex;
    }
    return new Report();
  }
}
```

## Middleware / Filtros

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

## Paginación y Ordenamiento

```java
PageRequest page = PageRequest.of(pageNumber, pageSize, Sort.by("createdAt").descending());
Page<Market> results = marketService.list(page);
```

## Llamadas Externas Resilientes a Errores

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

## Limitación de Velocidad (Filtro + Bucket4j)

**Nota de Seguridad**: La cabecera `X-Forwarded-For` no es confiable por defecto porque los clientes pueden falsificarla.
Solo usar cabeceras reenviadas cuando:
1. La aplicación está detrás de un proxy inverso de confianza (nginx, AWS ALB, etc.)
2. Se ha registrado `ForwardedHeaderFilter` como un bean
3. Se ha configurado `server.forward-headers-strategy=NATIVE` o `FRAMEWORK` en las propiedades de la aplicación
4. El proxy está configurado para sobrescribir (no agregar) la cabecera `X-Forwarded-For`

Cuando `ForwardedHeaderFilter` está correctamente configurado, `request.getRemoteAddr()` retornará
automáticamente la IP correcta del cliente desde las cabeceras reenviadas. Sin esta configuración, usar
`request.getRemoteAddr()` directamente — retorna la IP de la conexión inmediata, que es el único
valor confiable.

```java
@Component
public class RateLimitFilter extends OncePerRequestFilter {
  private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

  /*
   * SEGURIDAD: Este filtro usa request.getRemoteAddr() para identificar clientes en la limitación
   * de velocidad.
   *
   * Si la aplicación está detrás de un proxy inverso (nginx, AWS ALB, etc.), se DEBE configurar
   * Spring para manejar correctamente las cabeceras reenviadas:
   *
   * 1. Establecer server.forward-headers-strategy=NATIVE (para plataformas cloud) o FRAMEWORK
   *    en application.properties/yaml
   * 2. Si se usa la estrategia FRAMEWORK, registrar ForwardedHeaderFilter:
   *
   *    @Bean
   *    ForwardedHeaderFilter forwardedHeaderFilter() {
   *        return new ForwardedHeaderFilter();
   *    }
   *
   * 3. Asegurar que el proxy sobrescriba (no agregue) la cabecera X-Forwarded-For para prevenir
   *    falsificación
   * 4. Configurar server.tomcat.remoteip.trusted-proxies o equivalente para el contenedor
   *
   * Sin esta configuración, request.getRemoteAddr() retorna la IP del proxy, no del cliente.
   * NO leer X-Forwarded-For directamente — es trivialmente falsificable sin manejo de proxy confiable.
   */
  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
      FilterChain filterChain) throws ServletException, IOException {
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

## Jobs en Segundo Plano

Usar `@Scheduled` de Spring o integrar con colas (Kafka, SQS, RabbitMQ). Mantener los handlers idempotentes y observables.

## Observabilidad

- Logging estructurado (JSON) mediante Logback encoder
- Métricas: Micrometer + Prometheus/OTel
- Trazado: Micrometer Tracing con backend OpenTelemetry o Brave

## Configuraciones para Producción

- Preferir inyección por constructor, evitar inyección por campo
- Habilitar `spring.mvc.problemdetails.enabled=true` para errores RFC 7807 (Spring Boot 3+)
- Configurar tamaños del pool HikariCP para la carga de trabajo, establecer timeouts
- Usar `@Transactional(readOnly = true)` para consultas
- Reforzar null-safety mediante `@NonNull` y `Optional` donde corresponda

**Recuerda**: Mantener los controllers delgados, los servicios enfocados, los repositorios simples y los errores manejados centralmente. Optimizar para mantenibilidad y testabilidad.
