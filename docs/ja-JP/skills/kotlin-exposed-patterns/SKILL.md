---
name: kotlin-exposed-patterns
description: JetBrains Exposed ORM パターン（DSL クエリ、DAO パターン、トランザクション、HikariCP 接続プーリング、Flyway マイグレーション、リポジトリパターンを含む）。
origin: ECC
---

# Kotlin Exposed パターン

JetBrains Exposed ORM を使用したデータベースアクセスの包括的なパターン（DSL クエリ、DAO、トランザクション、プロダクション対応の設定を含む）。

## 使用するタイミング

- Exposed を使用したデータベースアクセスの設定
- Exposed DSL または DAO を使用した SQL クエリの作成
- HikariCP を使用した接続プーリングの設定
- Flyway を使用したデータベースマイグレーションの作成
- Exposed を使用したリポジトリパターンの実装
- JSON カラムと複雑なクエリの処理

## 動作の仕組み

Exposed は 2 つのクエリスタイルを提供します: 直接 SQL に似た表現のための DSL と、エンティティライフサイクル管理のための DAO です。HikariCP は `HikariConfig` を通じて設定された再利用可能なデータベース接続のプールを管理します。Flyway はスタートアップ時にバージョン管理された SQL マイグレーションスクリプトを実行してスキーマを同期させます。すべてのデータベース操作はコルーチンの安全性とアトミシティのために `newSuspendedTransaction` ブロック内で実行されます。リポジトリパターンはビジネスロジックをデータレイヤーから切り離し、テストがインメモリ H2 データベースを使用できるようにします。

## 使用例

### DSL クエリ

```kotlin
suspend fun findUserById(id: UUID): UserRow? =
    newSuspendedTransaction {
        UsersTable.selectAll()
            .where { UsersTable.id eq id }
            .map { it.toUser() }
            .singleOrNull()
    }
```

### DAO エンティティの使用

```kotlin
suspend fun createUser(request: CreateUserRequest): User =
    newSuspendedTransaction {
        UserEntity.new {
            name = request.name
            email = request.email
            role = request.role
        }.toModel()
    }
```

### HikariCP 設定

```kotlin
val hikariConfig = HikariConfig().apply {
    driverClassName = config.driver
    jdbcUrl = config.url
    username = config.username
    password = config.password
    maximumPoolSize = config.maxPoolSize
    isAutoCommit = false
    transactionIsolation = "TRANSACTION_READ_COMMITTED"
    validate()
}
```

## データベースセットアップ

### HikariCP 接続プーリング

```kotlin
// DatabaseFactory.kt
object DatabaseFactory {
    fun create(config: DatabaseConfig): Database {
        val hikariConfig = HikariConfig().apply {
            driverClassName = config.driver
            jdbcUrl = config.url
            username = config.username
            password = config.password
            maximumPoolSize = config.maxPoolSize
            isAutoCommit = false
            transactionIsolation = "TRANSACTION_READ_COMMITTED"
            validate()
        }

        return Database.connect(HikariDataSource(hikariConfig))
    }
}

data class DatabaseConfig(
    val url: String,
    val driver: String = "org.postgresql.Driver",
    val username: String = "",
    val password: String = "",
    val maxPoolSize: Int = 10,
)
```

### Flyway マイグレーション

```kotlin
// FlywayMigration.kt
fun runMigrations(config: DatabaseConfig) {
    Flyway.configure()
        .dataSource(config.url, config.username, config.password)
        .locations("classpath:db/migration")
        .baselineOnMigrate(true)
        .load()
        .migrate()
}

// アプリケーションスタートアップ
fun Application.module() {
    val config = DatabaseConfig(
        url = environment.config.property("database.url").getString(),
        username = environment.config.property("database.username").getString(),
        password = environment.config.property("database.password").getString(),
    )
    runMigrations(config)
    val database = DatabaseFactory.create(config)
    // ...
}
```

### マイグレーションファイル

```sql
-- src/main/resources/db/migration/V1__create_users.sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    role VARCHAR(20) NOT NULL DEFAULT 'USER',
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
```

## テーブル定義

### DSL スタイルのテーブル

```kotlin
// tables/UsersTable.kt
object UsersTable : UUIDTable("users") {
    val name = varchar("name", 100)
    val email = varchar("email", 255).uniqueIndex()
    val role = enumerationByName<Role>("role", 20)
    val metadata = jsonb<UserMetadata>("metadata", Json.Default).nullable()
    val createdAt = timestampWithTimeZone("created_at").defaultExpression(CurrentTimestampWithTimeZone)
    val updatedAt = timestampWithTimeZone("updated_at").defaultExpression(CurrentTimestampWithTimeZone)
}

object OrdersTable : UUIDTable("orders") {
    val userId = uuid("user_id").references(UsersTable.id)
    val status = enumerationByName<OrderStatus>("status", 20)
    val totalAmount = long("total_amount")
    val currency = varchar("currency", 3)
    val createdAt = timestampWithTimeZone("created_at").defaultExpression(CurrentTimestampWithTimeZone)
}

object OrderItemsTable : UUIDTable("order_items") {
    val orderId = uuid("order_id").references(OrdersTable.id, onDelete = ReferenceOption.CASCADE)
    val productId = uuid("product_id")
    val quantity = integer("quantity")
    val unitPrice = long("unit_price")
}
```

### 複合テーブル

```kotlin
object UserRolesTable : Table("user_roles") {
    val userId = uuid("user_id").references(UsersTable.id, onDelete = ReferenceOption.CASCADE)
    val roleId = uuid("role_id").references(RolesTable.id, onDelete = ReferenceOption.CASCADE)
    override val primaryKey = PrimaryKey(userId, roleId)
}
```

## DSL クエリ

### 基本的な CRUD

```kotlin
// 挿入
suspend fun insertUser(name: String, email: String, role: Role): UUID =
    newSuspendedTransaction {
        UsersTable.insertAndGetId {
            it[UsersTable.name] = name
            it[UsersTable.email] = email
            it[UsersTable.role] = role
        }.value
    }

// ID で選択
suspend fun findUserById(id: UUID): UserRow? =
    newSuspendedTransaction {
        UsersTable.selectAll()
            .where { UsersTable.id eq id }
            .map { it.toUser() }
            .singleOrNull()
    }

// 条件付き選択
suspend fun findActiveAdmins(): List<UserRow> =
    newSuspendedTransaction {
        UsersTable.selectAll()
            .where { (UsersTable.role eq Role.ADMIN) }
            .orderBy(UsersTable.name)
            .map { it.toUser() }
    }

// 更新
suspend fun updateUserEmail(id: UUID, newEmail: String): Boolean =
    newSuspendedTransaction {
        UsersTable.update({ UsersTable.id eq id }) {
            it[email] = newEmail
            it[updatedAt] = CurrentTimestampWithTimeZone
        } > 0
    }

// 削除
suspend fun deleteUser(id: UUID): Boolean =
    newSuspendedTransaction {
        UsersTable.deleteWhere { UsersTable.id eq id } > 0
    }

// 行マッピング
private fun ResultRow.toUser() = UserRow(
    id = this[UsersTable.id].value,
    name = this[UsersTable.name],
    email = this[UsersTable.email],
    role = this[UsersTable.role],
    metadata = this[UsersTable.metadata],
    createdAt = this[UsersTable.createdAt],
    updatedAt = this[UsersTable.updatedAt],
)
```

### 高度なクエリ

```kotlin
// JOIN クエリ
suspend fun findOrdersWithUser(userId: UUID): List<OrderWithUser> =
    newSuspendedTransaction {
        (OrdersTable innerJoin UsersTable)
            .selectAll()
            .where { OrdersTable.userId eq userId }
            .orderBy(OrdersTable.createdAt, SortOrder.DESC)
            .map { row ->
                OrderWithUser(
                    orderId = row[OrdersTable.id].value,
                    status = row[OrdersTable.status],
                    totalAmount = row[OrdersTable.totalAmount],
                    userName = row[UsersTable.name],
                )
            }
    }

// 集計
suspend fun countUsersByRole(): Map<Role, Long> =
    newSuspendedTransaction {
        UsersTable
            .select(UsersTable.role, UsersTable.id.count())
            .groupBy(UsersTable.role)
            .associate { row ->
                row[UsersTable.role] to row[UsersTable.id.count()]
            }
    }

// サブクエリ
suspend fun findUsersWithOrders(): List<UserRow> =
    newSuspendedTransaction {
        UsersTable.selectAll()
            .where {
                UsersTable.id inSubQuery
                    OrdersTable.select(OrdersTable.userId).withDistinct()
            }
            .map { it.toUser() }
    }

// LIKE とパターンマッチング — ワイルドカードインジェクションを防ぐため常にユーザー入力をエスケープ
private fun escapeLikePattern(input: String): String =
    input.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

suspend fun searchUsers(query: String): List<UserRow> =
    newSuspendedTransaction {
        val sanitized = escapeLikePattern(query.lowercase())
        UsersTable.selectAll()
            .where {
                (UsersTable.name.lowerCase() like "%${sanitized}%") or
                    (UsersTable.email.lowerCase() like "%${sanitized}%")
            }
            .map { it.toUser() }
    }
```

### ページネーション

```kotlin
data class Page<T>(
    val data: List<T>,
    val total: Long,
    val page: Int,
    val limit: Int,
) {
    val totalPages: Int get() = ((total + limit - 1) / limit).toInt()
    val hasNext: Boolean get() = page < totalPages
    val hasPrevious: Boolean get() = page > 1
}

suspend fun findUsersPaginated(page: Int, limit: Int): Page<UserRow> =
    newSuspendedTransaction {
        val total = UsersTable.selectAll().count()
        val data = UsersTable.selectAll()
            .orderBy(UsersTable.createdAt, SortOrder.DESC)
            .limit(limit)
            .offset(((page - 1) * limit).toLong())
            .map { it.toUser() }

        Page(data = data, total = total, page = page, limit = limit)
    }
```

### バッチ操作

```kotlin
// バッチ挿入
suspend fun insertUsers(users: List<CreateUserRequest>): List<UUID> =
    newSuspendedTransaction {
        UsersTable.batchInsert(users) { user ->
            this[UsersTable.name] = user.name
            this[UsersTable.email] = user.email
            this[UsersTable.role] = user.role
        }.map { it[UsersTable.id].value }
    }

// アップサート（競合時に挿入または更新）
suspend fun upsertUser(id: UUID, name: String, email: String) {
    newSuspendedTransaction {
        UsersTable.upsert(UsersTable.email) {
            it[UsersTable.id] = EntityID(id, UsersTable)
            it[UsersTable.name] = name
            it[UsersTable.email] = email
            it[updatedAt] = CurrentTimestampWithTimeZone
        }
    }
}
```

## DAO パターン

### エンティティ定義

```kotlin
// entities/UserEntity.kt
class UserEntity(id: EntityID<UUID>) : UUIDEntity(id) {
    companion object : UUIDEntityClass<UserEntity>(UsersTable)

    var name by UsersTable.name
    var email by UsersTable.email
    var role by UsersTable.role
    var metadata by UsersTable.metadata
    var createdAt by UsersTable.createdAt
    var updatedAt by UsersTable.updatedAt

    val orders by OrderEntity referrersOn OrdersTable.userId

    fun toModel(): User = User(
        id = id.value,
        name = name,
        email = email,
        role = role,
        metadata = metadata,
        createdAt = createdAt,
        updatedAt = updatedAt,
    )
}

class OrderEntity(id: EntityID<UUID>) : UUIDEntity(id) {
    companion object : UUIDEntityClass<OrderEntity>(OrdersTable)

    var user by UserEntity referencedOn OrdersTable.userId
    var status by OrdersTable.status
    var totalAmount by OrdersTable.totalAmount
    var currency by OrdersTable.currency
    var createdAt by OrdersTable.createdAt

    val items by OrderItemEntity referrersOn OrderItemsTable.orderId
}
```

### DAO 操作

```kotlin
suspend fun findUserByEmail(email: String): User? =
    newSuspendedTransaction {
        UserEntity.find { UsersTable.email eq email }
            .firstOrNull()
            ?.toModel()
    }

suspend fun createUser(request: CreateUserRequest): User =
    newSuspendedTransaction {
        UserEntity.new {
            name = request.name
            email = request.email
            role = request.role
        }.toModel()
    }

suspend fun updateUser(id: UUID, request: UpdateUserRequest): User? =
    newSuspendedTransaction {
        UserEntity.findById(id)?.apply {
            request.name?.let { name = it }
            request.email?.let { email = it }
            updatedAt = OffsetDateTime.now(ZoneOffset.UTC)
        }?.toModel()
    }
```

## トランザクション

### サスペンドトランザクションのサポート

```kotlin
// 良い例: コルーチンサポートのために newSuspendedTransaction を使用
suspend fun performDatabaseOperation(): Result<User> =
    runCatching {
        newSuspendedTransaction {
            val user = UserEntity.new {
                name = "Alice"
                email = "alice@example.com"
            }
            // このブロック内のすべての操作はアトミック
            user.toModel()
        }
    }

// 良い例: セーブポイントによるネストされたトランザクション
suspend fun transferFunds(fromId: UUID, toId: UUID, amount: Long) {
    newSuspendedTransaction {
        val from = UserEntity.findById(fromId) ?: throw NotFoundException("User $fromId not found")
        val to = UserEntity.findById(toId) ?: throw NotFoundException("User $toId not found")

        // デビット
        from.balance -= amount
        // クレジット
        to.balance += amount

        // 両方が成功するか両方が失敗するか
    }
}
```

### トランザクション分離

```kotlin
suspend fun readCommittedQuery(): List<User> =
    newSuspendedTransaction(transactionIsolation = Connection.TRANSACTION_READ_COMMITTED) {
        UserEntity.all().map { it.toModel() }
    }

suspend fun serializableOperation() {
    newSuspendedTransaction(transactionIsolation = Connection.TRANSACTION_SERIALIZABLE) {
        // クリティカルな操作のための最も厳格な分離レベル
    }
}
```

## リポジトリパターン

### インターフェース定義

```kotlin
interface UserRepository {
    suspend fun findById(id: UUID): User?
    suspend fun findByEmail(email: String): User?
    suspend fun findAll(page: Int, limit: Int): Page<User>
    suspend fun search(query: String): List<User>
    suspend fun create(request: CreateUserRequest): User
    suspend fun update(id: UUID, request: UpdateUserRequest): User?
    suspend fun delete(id: UUID): Boolean
    suspend fun count(): Long
}
```

### Exposed 実装

```kotlin
class ExposedUserRepository(
    private val database: Database,
) : UserRepository {

    override suspend fun findById(id: UUID): User? =
        newSuspendedTransaction(db = database) {
            UsersTable.selectAll()
                .where { UsersTable.id eq id }
                .map { it.toUser() }
                .singleOrNull()
        }

    override suspend fun findByEmail(email: String): User? =
        newSuspendedTransaction(db = database) {
            UsersTable.selectAll()
                .where { UsersTable.email eq email }
                .map { it.toUser() }
                .singleOrNull()
        }

    override suspend fun findAll(page: Int, limit: Int): Page<User> =
        newSuspendedTransaction(db = database) {
            val total = UsersTable.selectAll().count()
            val data = UsersTable.selectAll()
                .orderBy(UsersTable.createdAt, SortOrder.DESC)
                .limit(limit)
                .offset(((page - 1) * limit).toLong())
                .map { it.toUser() }
            Page(data = data, total = total, page = page, limit = limit)
        }

    override suspend fun search(query: String): List<User> =
        newSuspendedTransaction(db = database) {
            val sanitized = escapeLikePattern(query.lowercase())
            UsersTable.selectAll()
                .where {
                    (UsersTable.name.lowerCase() like "%${sanitized}%") or
                        (UsersTable.email.lowerCase() like "%${sanitized}%")
                }
                .orderBy(UsersTable.name)
                .map { it.toUser() }
        }

    override suspend fun create(request: CreateUserRequest): User =
        newSuspendedTransaction(db = database) {
            UsersTable.insert {
                it[name] = request.name
                it[email] = request.email
                it[role] = request.role
            }.resultedValues!!.first().toUser()
        }

    override suspend fun update(id: UUID, request: UpdateUserRequest): User? =
        newSuspendedTransaction(db = database) {
            val updated = UsersTable.update({ UsersTable.id eq id }) {
                request.name?.let { name -> it[UsersTable.name] = name }
                request.email?.let { email -> it[UsersTable.email] = email }
                it[updatedAt] = CurrentTimestampWithTimeZone
            }
            if (updated > 0) findById(id) else null
        }

    override suspend fun delete(id: UUID): Boolean =
        newSuspendedTransaction(db = database) {
            UsersTable.deleteWhere { UsersTable.id eq id } > 0
        }

    override suspend fun count(): Long =
        newSuspendedTransaction(db = database) {
            UsersTable.selectAll().count()
        }

    private fun ResultRow.toUser() = User(
        id = this[UsersTable.id].value,
        name = this[UsersTable.name],
        email = this[UsersTable.email],
        role = this[UsersTable.role],
        metadata = this[UsersTable.metadata],
        createdAt = this[UsersTable.createdAt],
        updatedAt = this[UsersTable.updatedAt],
    )
}
```

## JSON カラム

### kotlinx.serialization を使用した JSONB

```kotlin
// JSONB のカスタムカラム型
inline fun <reified T : Any> Table.jsonb(
    name: String,
    json: Json,
): Column<T> = registerColumn(name, object : ColumnType<T>() {
    override fun sqlType() = "JSONB"

    override fun valueFromDB(value: Any): T = when (value) {
        is String -> json.decodeFromString(value)
        is PGobject -> {
            val jsonString = value.value
                ?: throw IllegalArgumentException("PGobject value is null for column '$name'")
            json.decodeFromString(jsonString)
        }
        else -> throw IllegalArgumentException("Unexpected value: $value")
    }

    override fun notNullValueToDB(value: T): Any =
        PGobject().apply {
            type = "jsonb"
            this.value = json.encodeToString(value)
        }
})

// テーブルでの使用
@Serializable
data class UserMetadata(
    val preferences: Map<String, String> = emptyMap(),
    val tags: List<String> = emptyList(),
)

object UsersTable : UUIDTable("users") {
    val metadata = jsonb<UserMetadata>("metadata", Json.Default).nullable()
}
```

## Exposed でのテスト

### テスト用インメモリデータベース

```kotlin
class UserRepositoryTest : FunSpec({
    lateinit var database: Database
    lateinit var repository: UserRepository

    beforeSpec {
        database = Database.connect(
            url = "jdbc:h2:mem:test;DB_CLOSE_DELAY=-1;MODE=PostgreSQL",
            driver = "org.h2.Driver",
        )
        transaction(database) {
            SchemaUtils.create(UsersTable)
        }
        repository = ExposedUserRepository(database)
    }

    beforeTest {
        transaction(database) {
            UsersTable.deleteAll()
        }
    }

    test("create and find user") {
        val user = repository.create(CreateUserRequest("Alice", "alice@example.com"))

        user.name shouldBe "Alice"
        user.email shouldBe "alice@example.com"

        val found = repository.findById(user.id)
        found shouldBe user
    }

    test("findByEmail returns null for unknown email") {
        val result = repository.findByEmail("unknown@example.com")
        result.shouldBeNull()
    }

    test("pagination works correctly") {
        repeat(25) { i ->
            repository.create(CreateUserRequest("User $i", "user$i@example.com"))
        }

        val page1 = repository.findAll(page = 1, limit = 10)
        page1.data shouldHaveSize 10
        page1.total shouldBe 25
        page1.hasNext shouldBe true

        val page3 = repository.findAll(page = 3, limit = 10)
        page3.data shouldHaveSize 5
        page3.hasNext shouldBe false
    }
})
```

## Gradle 依存関係

```kotlin
// build.gradle.kts
dependencies {
    // Exposed
    implementation("org.jetbrains.exposed:exposed-core:1.0.0")
    implementation("org.jetbrains.exposed:exposed-dao:1.0.0")
    implementation("org.jetbrains.exposed:exposed-jdbc:1.0.0")
    implementation("org.jetbrains.exposed:exposed-kotlin-datetime:1.0.0")
    implementation("org.jetbrains.exposed:exposed-json:1.0.0")

    // データベースドライバー
    implementation("org.postgresql:postgresql:42.7.5")

    // 接続プーリング
    implementation("com.zaxxer:HikariCP:6.2.1")

    // マイグレーション
    implementation("org.flywaydb:flyway-core:10.22.0")
    implementation("org.flywaydb:flyway-database-postgresql:10.22.0")

    // テスト
    testImplementation("com.h2database:h2:2.3.232")
}
```

## クイックリファレンス: Exposed パターン

| パターン | 説明 |
|---------|------|
| `object Table : UUIDTable("name")` | UUID 主キーを持つテーブルを定義 |
| `newSuspendedTransaction { }` | コルーチン安全なトランザクションブロック |
| `Table.selectAll().where { }` | 条件付きクエリ |
| `Table.insertAndGetId { }` | 挿入して生成された ID を返す |
| `Table.update({ condition }) { }` | 一致する行を更新 |
| `Table.deleteWhere { }` | 一致する行を削除 |
| `Table.batchInsert(items) { }` | 効率的なバルク挿入 |
| `innerJoin` / `leftJoin` | テーブルの結合 |
| `orderBy` / `limit` / `offset` | ソートとページネーション |
| `count()` / `sum()` / `avg()` | 集計関数 |

**覚えておくこと**: シンプルなクエリには DSL スタイルを、エンティティライフサイクル管理が必要な場合は DAO スタイルを使用してください。コルーチンサポートには必ず `newSuspendedTransaction` を使用し、テスト可能性のためにデータベース操作をリポジトリインターフェースの後ろにラップしてください。
