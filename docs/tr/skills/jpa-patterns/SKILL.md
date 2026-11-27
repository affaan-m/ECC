---
name: jpa-patterns
description: Spring Boot'ta entity tasarımı, ilişkiler, sorgu optimizasyonu, transaction'lar, auditing, indeksleme, sayfalama ve pooling için JPA/Hibernate kalıpları.
origin: ECC
---

# JPA/Hibernate Kalıpları

Spring Boot'ta veri modelleme, repository'ler ve performans ayarlaması için kullanın.

## Ne Zaman Aktifleştirmeli

- JPA entity'leri ve tablo eşlemelerini tasarlarken
- İlişkileri tanımlarken (@OneToMany, @ManyToOne, @ManyToMany)
- Sorguları optimize ederken (N+1 önleme, fetch stratejileri, projections)
- Transaction'ları, auditing'i veya soft delete'leri yapılandırırken
- Sayfalama, sıralama veya özel repository metodları kurarken
- Connection pooling (HikariCP) veya second-level caching ayarlarken

## Entity Tasarımı

```java
@Entity
@Table(name = "markets", indexes = {
  @Index(name = "idx_markets_slug", columnList = "slug", unique = true)
})
@EntityListeners(AuditingEntityListener.class)
public class MarketEntity {
  @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false, length = 200)
  private String name;

  @Column(nullable = false, unique = true, length = 120)
  private String slug;

  @Enumerated(EnumType.STRING)
  private MarketStatus status = MarketStatus.ACTIVE;

  @CreatedDate private Instant createdAt;
  @LastModifiedDate private Instant updatedAt;
}
```

Auditing'i etkinleştir:
```java
@Configuration
@EnableJpaAuditing
class JpaConfig {}
```

## İlişkiler ve N+1 Önleme

```java
@OneToMany(mappedBy = "market", cascade = CascadeType.ALL, orphanRemoval = true)
private List<PositionEntity> positions = new ArrayList<>();
```

- Varsayılan olarak lazy loading; gerektiğinde sorgularda `JOIN FETCH` kullan
- Koleksiyonlarda `EAGER` kullanmaktan kaçın; okuma yolları için DTO projections kullan

```java
@Query("select m from MarketEntity m left join fetch m.positions where m.id = :id")
Optional<MarketEntity> findWithPositions(@Param("id") Long id);
```

## Repository Kalıpları

```java
public interface MarketRepository extends JpaRepository<MarketEntity, Long> {
  Optional<MarketEntity> findBySlug(String slug);

  @Query("select m from MarketEntity m where m.status = :status")
  Page<MarketEntity> findByStatus(@Param("status") MarketStatus status, Pageable pageable);
}
```

- Hafif sorgular için projections kullan:
```java
public interface MarketSummary {
  Long getId();
  String getName();
  MarketStatus getStatus();
}
Page<MarketSummary> findAllBy(Pageable pageable);
```

## Transaction'lar

- Servis metodlarını `@Transactional` ile işaretle
- Okuma yollarını optimize etmek için `@Transactional(readOnly = true)` kullan
- Propagation'ı dikkatle seç; uzun süreli transaction'lardan kaçın

```java
@Transactional
public Market updateStatus(Long id, MarketStatus status) {
  MarketEntity entity = repo.findById(id)
      .orElseThrow(() -> new EntityNotFoundException("Market"));
  entity.setStatus(status);
  return Market.from(entity);
}
```

## Sayfalama

```java
PageRequest page = PageRequest.of(pageNumber, pageSize, Sort.by("createdAt").descending());
Page<MarketEntity> markets = repo.findByStatus(MarketStatus.ACTIVE, page);
```

Cursor benzeri sayfalama için, sıralama ile birlikte JPQL'de `id > :lastId` ekle.

## İndeksleme ve Performans

- Yaygın filtreler için indeksler ekle (`status`, `slug`, foreign key'ler)
- Sorgu kalıplarına uyan composite indeksler kullan (`status, created_at`)
- `select *` kullanmaktan kaçın; sadece gerekli sütunları project et
- `saveAll` ve `hibernate.jdbc.batch_size` ile yazmaları batch'le

## Connection Pooling (HikariCP)

Önerilen özellikler:
```
spring.datasource.hikari.maximum-pool-size=20
spring.datasource.hikari.minimum-idle=5
spring.datasource.hikari.connection-timeout=30000
spring.datasource.hikari.validation-timeout=5000
```

PostgreSQL LOB işleme için ekle:
```
spring.jpa.properties.hibernate.jdbc.lob.non_contextual_creation=true
```

## Caching

- 1st-level cache EntityManager başına; transaction'lar arası entity'leri tutmaktan kaçın
- Okuma ağırlıklı entity'ler için second-level cache'i dikkatle düşün; eviction stratejisini doğrula

## Migration'lar

- Flyway veya Liquibase kullan; üretimde Hibernate auto DDL'ye asla güvenme
- Migration'ları idempotent ve ekleyici tut; plan olmadan sütun kaldırmaktan kaçın

## Veri Erişimi Testi

- Üretimi yansıtmak için Testcontainers ile `@DataJpaTest` tercih et
- Logları kullanarak SQL verimliliğini assert et: parametre değerleri için `logging.level.org.hibernate.SQL=DEBUG` ve `logging.level.org.hibernate.orm.jdbc.bind=TRACE` ayarla

**Hatırla**: Entity'leri yalın, sorguları kasıtlı ve transaction'ları kısa tut. Fetch stratejileri ve projections ile N+1'i önle, ve okuma/yazma yolların için indeksle.
