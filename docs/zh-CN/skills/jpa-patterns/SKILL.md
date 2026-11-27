---
name: jpa-patterns
description: Spring Boot中的JPA/Hibernate模式，用于实体设计、关系处理、查询优化、事务管理、审计、索引、分页和连接池。
origin: ECC
---

# JPA/Hibernate 模式

用于 Spring Boot 中的数据建模、存储库和性能调优。

## 何时激活

* 设计 JPA 实体和表映射时
* 定义关系时 (@OneToMany, @ManyToOne, @ManyToMany)
* 优化查询时 (N+1 问题预防、获取策略、投影)
* 配置事务、审计或软删除时
* 设置分页、排序或自定义存储库方法时
* 调整连接池 (HikariCP) 或二级缓存时

## 实体设计

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

启用审计：

```java
@Configuration
@EnableJpaAuditing
class JpaConfig {}
```

## 关联关系和 N+1 预防

```java
@OneToMany(mappedBy = "market", cascade = CascadeType.ALL, orphanRemoval = true)
private List<PositionEntity> positions = new ArrayList<>();
```

* 默认使用延迟加载；需要时在查询中使用 `JOIN FETCH`
* 避免在集合上使用 `EAGER`；对于读取路径使用 DTO 投影

```java
@Query("select m from MarketEntity m left join fetch m.positions where m.id = :id")
Optional<MarketEntity> findWithPositions(@Param("id") Long id);
```

## 存储库模式

```java
public interface MarketRepository extends JpaRepository<MarketEntity, Long> {
  Optional<MarketEntity> findBySlug(String slug);

  @Query("select m from MarketEntity m where m.status = :status")
  Page<MarketEntity> findByStatus(@Param("status") MarketStatus status, Pageable pageable);
}
```

* 使用投影进行轻量级查询：

```java
public interface MarketSummary {
  Long getId();
  String getName();
  MarketStatus getStatus();
}
Page<MarketSummary> findAllBy(Pageable pageable);
```

## 事务

* 使用 `@Transactional` 注解服务方法
* 对读取路径使用 `@Transactional(readOnly = true)` 以进行优化
* 谨慎选择传播行为；避免长时间运行的事务

```java
@Transactional
public Market updateStatus(Long id, MarketStatus status) {
  MarketEntity entity = repo.findById(id)
      .orElseThrow(() -> new EntityNotFoundException("Market"));
  entity.setStatus(status);
  return Market.from(entity);
}
```

## 分页

```java
PageRequest page = PageRequest.of(pageNumber, pageSize, Sort.by("createdAt").descending());
Page<MarketEntity> markets = repo.findByStatus(MarketStatus.ACTIVE, page);
```

对于类似游标的分页，在 JPQL 中包含 `id > :lastId` 并配合排序。

## 索引和性能

* 为常用过滤器添加索引（`status`、`slug`、外键）
* 使用与查询模式匹配的复合索引（`status, created_at`）
* 避免 `select *`；仅投影需要的列
* 使用 `saveAll` 和 `hibernate.jdbc.batch_size` 进行批量写入

## 连接池 (HikariCP)

推荐属性：

```
spring.datasource.hikari.maximum-pool-size=20
spring.datasource.hikari.minimum-idle=5
spring.datasource.hikari.connection-timeout=30000
spring.datasource.hikari.validation-timeout=5000
```

对于 PostgreSQL LOB 处理，添加：

```
spring.jpa.properties.hibernate.jdbc.lob.non_contextual_creation=true
```

## 缓存

* 一级缓存是每个 EntityManager 的；避免在事务之间保持实体
* 对于读取频繁的实体，谨慎考虑二级缓存；验证驱逐策略

## 迁移

* 使用 Flyway 或 Liquibase；切勿在生产中依赖 Hibernate 自动 DDL
* 保持迁移的幂等性和可添加性；避免无计划地删除列

## 测试数据访问

* 首选使用 Testcontainers 的 `@DataJpaTest` 来镜像生产环境
* 使用日志断言 SQL 效率：设置 `logging.level.org.hibernate.SQL=DEBUG` 和 `logging.level.org.hibernate.orm.jdbc.bind=TRACE` 以查看参数值

**请记住**：保持实体精简，查询有针对性，事务简短。通过获取策略和投影来预防 N+1 问题，并根据读写路径建立索引。
