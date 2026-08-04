---
name: jpa-patterns
description: Patrones JPA/Hibernate para diseño de entidades, relaciones, optimización de consultas, transacciones, auditoría, indexación, paginación y pooling en Spring Boot.
origin: ECC
---

# Patrones JPA/Hibernate

Usar para modelado de datos, repositorios y ajuste de rendimiento en Spring Boot.

## Cuándo Activar

- Diseñar entidades JPA y mapeos de tablas
- Definir relaciones (@OneToMany, @ManyToOne, @ManyToMany)
- Optimizar consultas (prevención de N+1, estrategias de fetch, proyecciones)
- Configurar transacciones, auditoría o soft deletes
- Configurar paginación, ordenamiento o métodos de repositorio personalizados
- Ajustar el connection pool (HikariCP) o caché de segundo nivel

## Diseño de Entidades

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

Habilitar auditoría:
```java
@Configuration
@EnableJpaAuditing
class JpaConfig {}
```

## Relaciones y Prevención de N+1

```java
@OneToMany(mappedBy = "market", cascade = CascadeType.ALL, orphanRemoval = true)
private List<PositionEntity> positions = new ArrayList<>();
```

- Usar lazy loading por defecto; usar `JOIN FETCH` en consultas cuando sea necesario
- Evitar `EAGER` en colecciones; usar proyecciones DTO para rutas de lectura

```java
@Query("select m from MarketEntity m left join fetch m.positions where m.id = :id")
Optional<MarketEntity> findWithPositions(@Param("id") Long id);
```

## Patrones de Repositorio

```java
public interface MarketRepository extends JpaRepository<MarketEntity, Long> {
  Optional<MarketEntity> findBySlug(String slug);

  @Query("select m from MarketEntity m where m.status = :status")
  Page<MarketEntity> findByStatus(@Param("status") MarketStatus status, Pageable pageable);
}
```

- Usar proyecciones para consultas ligeras:
```java
public interface MarketSummary {
  Long getId();
  String getName();
  MarketStatus getStatus();
}
Page<MarketSummary> findAllBy(Pageable pageable);
```

## Transacciones

- Anotar métodos de servicio con `@Transactional`
- Usar `@Transactional(readOnly = true)` para rutas de lectura y optimizar
- Elegir la propagación cuidadosamente; evitar transacciones de larga duración

```java
@Transactional
public Market updateStatus(Long id, MarketStatus status) {
  MarketEntity entity = repo.findById(id)
      .orElseThrow(() -> new EntityNotFoundException("Market"));
  entity.setStatus(status);
  return Market.from(entity);
}
```

## Paginación

```java
PageRequest page = PageRequest.of(pageNumber, pageSize, Sort.by("createdAt").descending());
Page<MarketEntity> markets = repo.findByStatus(MarketStatus.ACTIVE, page);
```

Para paginación tipo cursor, incluir `id > :lastId` en JPQL con ordenamiento.

## Indexación y Rendimiento

- Agregar índices para filtros comunes (`status`, `slug`, claves foráneas)
- Usar índices compuestos que coincidan con patrones de consulta (`status, created_at`)
- Evitar `select *`; proyectar solo las columnas necesarias
- Escrituras en lote con `saveAll` y `hibernate.jdbc.batch_size`

## Connection Pooling (HikariCP)

Propiedades recomendadas:
```
spring.datasource.hikari.maximum-pool-size=20
spring.datasource.hikari.minimum-idle=5
spring.datasource.hikari.connection-timeout=30000
spring.datasource.hikari.validation-timeout=5000
```

Para el manejo de LOB en PostgreSQL, agregar:
```
spring.jpa.properties.hibernate.jdbc.lob.non_contextual_creation=true
```

## Caché

- La caché de primer nivel es por EntityManager; evitar mantener entidades entre transacciones
- Para entidades con muchas lecturas, considerar la caché de segundo nivel con cautela; validar la estrategia de evicción

## Migraciones

- Usar Flyway o Liquibase; nunca depender de auto DDL de Hibernate en producción
- Mantener las migraciones idempotentes y aditivas; evitar eliminar columnas sin un plan

## Pruebas de Acceso a Datos

- Preferir `@DataJpaTest` con Testcontainers para replicar producción
- Verificar la eficiencia SQL con logs: establecer `logging.level.org.hibernate.SQL=DEBUG` y `logging.level.org.hibernate.orm.jdbc.bind=TRACE` para valores de parámetros

**Recuerda**: Mantener las entidades ligeras, las consultas intencionales y las transacciones cortas. Prevenir N+1 con estrategias de fetch y proyecciones, e indexar para tus rutas de lectura/escritura.
