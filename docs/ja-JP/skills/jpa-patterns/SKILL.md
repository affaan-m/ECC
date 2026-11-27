---
name: jpa-patterns
description: JPA/Hibernate patterns for entity design, relationships, query optimization, transactions, auditing, indexing, pagination, and pooling in Spring Boot.
---

# JPA/Hibernate パターン

Spring Bootでのデータモデリング、リポジトリ、パフォーマンスチューニングに使用します。

## エンティティ設計

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

監査を有効化:
```java
@Configuration
@EnableJpaAuditing
class JpaConfig {}
```

## リレーションシップとN+1防止

```java
@OneToMany(mappedBy = "market", cascade = CascadeType.ALL, orphanRemoval = true)
private List<PositionEntity> positions = new ArrayList<>();
```

- デフォルトで遅延ロード。必要に応じてクエリで `JOIN FETCH` を使用
- コレクションでは `EAGER` を避け、読み取りパスにはDTOプロジェクションを使用

```java
@Query("select m from MarketEntity m left join fetch m.positions where m.id = :id")
Optional<MarketEntity> findWithPositions(@Param("id") Long id);
```

## リポジトリパターン

```java
public interface MarketRepository extends JpaRepository<MarketEntity, Long> {
  Optional<MarketEntity> findBySlug(String slug);

  @Query("select m from MarketEntity m where m.status = :status")
  Page<MarketEntity> findByStatus(@Param("status") MarketStatus status, Pageable pageable);
}
```

- 軽量クエリにはプロジェクションを使用:
```java
public interface MarketSummary {
  Long getId();
  String getName();
  MarketStatus getStatus();
}
Page<MarketSummary> findAllBy(Pageable pageable);
```

## トランザクション

- サービスメソッドに `@Transactional` を付ける
- 読み取りパスを最適化するために `@Transactional(readOnly = true)` を使用
- 伝播を慎重に選択。長時間実行されるトランザクションを避ける

```java
@Transactional
public Market updateStatus(Long id, MarketStatus status) {
  MarketEntity entity = repo.findById(id)
      .orElseThrow(() -> new EntityNotFoundException("Market"));
  entity.setStatus(status);
  return Market.from(entity);
}
```

## ページネーション

```java
PageRequest page = PageRequest.of(pageNumber, pageSize, Sort.by("createdAt").descending());
Page<MarketEntity> markets = repo.findByStatus(MarketStatus.ACTIVE, page);
```

カーソルライクなページネーションには、順序付けでJPQLに `id > :lastId` を含める。

## インデックス作成とパフォーマンス

- 一般的なフィルタ（`status`、`slug`、外部キー）にインデックスを追加
- クエリパターンに一致する複合インデックスを使用（`status, created_at`）
- `select *` を避け、必要な列のみを投影
- `saveAll` と `hibernate.jdbc.batch_size` でバッチ書き込み

## コネクションプーリング（HikariCP）

推奨プロパティ:
```
spring.datasource.hikari.maximum-pool-size=20
spring.datasource.hikari.minimum-idle=5
spring.datasource.hikari.connection-timeout=30000
spring.datasource.hikari.validation-timeout=5000
```

PostgreSQL LOB処理には、次を追加:
```
spring.jpa.properties.hibernate.jdbc.lob.non_contextual_creation=true
```

## キャッシング

- 1次キャッシュはEntityManagerごと。トランザクション間でエンティティを保持しない
- 読み取り集約型エンティティには、2次キャッシュを慎重に検討。退避戦略を検証

## マイグレーション

- FlywayまたはLiquibaseを使用。本番環境でHibernate自動DDLに依存しない
- マイグレーションを冪等かつ追加的に保つ。計画なしに列を削除しない

## データアクセステスト

- 本番環境を反映するために、Testcontainersを使用した `@DataJpaTest` を優先
- ログを使用してSQL効率をアサート: パラメータ値には `logging.level.org.hibernate.SQL=DEBUG` と `logging.level.org.hibernate.orm.jdbc.bind=TRACE` を設定

**注意**: エンティティを軽量に保ち、クエリを意図的にし、トランザクションを短く保ちます。フェッチ戦略とプロジェクションでN+1を防ぎ、読み取り/書き込みパスにインデックスを作成します。
