---
name: jpa-patterns
description: JPA/Hibernate patterns for entity design, relationships, query optimization, transactions, auditing, indexing, pagination, and pooling in Spring Boot.
---

# JPA/Hibernate Patterns

Use for data modeling, repositories, and performance tuning in Spring Boot.

## When to Activate

- Designing JPA entities and table mappings
- Defining relationships (@OneToMany, @ManyToOne, @ManyToMany)
- Optimizing queries (N+1 prevention, fetch strategies, projections)
- Configuring transactions, auditing, or soft deletes
- Setting up pagination, sorting, or custom repository methods
- Tuning connection pooling (HikariCP) or second-level caching

## Entity Design

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

Enable auditing:
```java
@Configuration
@EnableJpaAuditing
class JpaConfig {}
```

## Relationships and N+1 Prevention

```java
@OneToMany(mappedBy = "market", cascade = CascadeType.ALL, orphanRemoval = true)
private List<PositionEntity> positions = new ArrayList<>();
```

- Default to lazy loading; use `JOIN FETCH` in queries when needed
- Avoid `EAGER` on collections; use DTO projections for read paths

```java
@Query("select m from MarketEntity m left join fetch m.positions where m.id = :id")
Optional<MarketEntity> findWithPositions(@Param("id") Long id);
```

## Repository Patterns

```java
public interface MarketRepository extends JpaRepository<MarketEntity, Long> {
  Optional<MarketEntity> findBySlug(String slug);

  @Query("select m from MarketEntity m where m.status = :status")
  Page<MarketEntity> findByStatus(@Param("status") MarketStatus status, Pageable pageable);
}
```

- Use projections for lightweight queries:
```java
public interface MarketSummary {
  Long getId();
  String getName();
  MarketStatus getStatus();
}
Page<MarketSummary> findAllBy(Pageable pageable);
```

## Transactions

- Annotate service methods with `@Transactional`
- Use `@Transactional(readOnly = true)` for read paths to optimize
- Choose propagation carefully; avoid long-running transactions

```java
@Transactional
public Market updateStatus(Long id, MarketStatus status) {
  MarketEntity entity = repo.findById(id)
      .orElseThrow(() -> new EntityNotFoundException("Market"));
  entity.setStatus(status);
  return Market.from(entity);
}
```

## Pagination

```java
PageRequest page = PageRequest.of(pageNumber, pageSize, Sort.by("createdAt").descending());
Page<MarketEntity> markets = repo.findByStatus(MarketStatus.ACTIVE, page);
```

For cursor-like pagination, include `id > :lastId` in JPQL with ordering.

## Indexing and Performance

- Add indexes for common filters (`status`, `slug`, foreign keys)
- Use composite indexes matching query patterns (`status, created_at`)
- Avoid `select *`; project only needed columns
- Batch writes with `saveAll` and `hibernate.jdbc.batch_size`

## Connection Pooling (HikariCP)

Recommended properties:
```
spring.datasource.hikari.maximum-pool-size=20
spring.datasource.hikari.minimum-idle=5
spring.datasource.hikari.connection-timeout=30000
spring.datasource.hikari.validation-timeout=5000
```

For PostgreSQL LOB handling, add:
```
spring.jpa.properties.hibernate.jdbc.lob.non_contextual_creation=true
```

## Caching

- 1st-level cache is per EntityManager; avoid keeping entities across transactions
- For read-heavy entities, consider second-level cache cautiously; validate eviction strategy

## Migrations

- Use Flyway or Liquibase; never rely on Hibernate auto DDL in production
- Keep migrations idempotent and additive; avoid dropping columns without plan

## Testing Data Access

- Prefer `@DataJpaTest` with Testcontainers to mirror production
- Assert SQL efficiency using logs: set `logging.level.org.hibernate.SQL=DEBUG` and `logging.level.org.hibernate.orm.jdbc.bind=TRACE` for parameter values

**Remember**: Keep entities lean, queries intentional, and transactions short. Prevent N+1 with fetch strategies and projections, and index for your read/write paths.
