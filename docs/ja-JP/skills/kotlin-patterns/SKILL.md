---
name: kotlin-patterns
description: コルーチン、null 安全性、DSL ビルダーを使用して堅牢・効率的・保守性の高い Kotlin アプリケーションを構築するための慣用的な Kotlin パターン、ベストプラクティス、規約。
origin: ECC
---

# Kotlin 開発パターン

堅牢・効率的・保守性の高いアプリケーションを構築するための慣用的な Kotlin パターンとベストプラクティス。

## 使用するタイミング

- 新しい Kotlin コードを書く
- Kotlin コードをレビューする
- 既存の Kotlin コードをリファクタリングする
- Kotlin モジュールまたはライブラリを設計する
- Gradle Kotlin DSL ビルドを設定する

## 動作の仕組み

このスキルは 7 つの主要領域にわたって慣用的な Kotlin の規約を適用します: 型システムとセーフコール演算子を使用した null 安全性、`val` とデータクラスの `copy()` によるイミュータビリティ、網羅的な型階層のためのシールドクラスとインターフェース、コルーチンと `Flow` による構造化並行性、継承なしで振る舞いを追加する拡張関数、`@DslMarker` とラムダレシーバーを使用した型安全 DSL ビルダー、そしてビルド設定のための Gradle Kotlin DSL。

## 使用例

**Elvis 演算子を使用した null 安全性:**
```kotlin
fun getUserEmail(userId: String): String {
    val user = userRepository.findById(userId)
    return user?.email ?: "unknown@example.com"
}
```

**網羅的な結果のためのシールドクラス:**
```kotlin
sealed class Result<out T> {
    data class Success<T>(val data: T) : Result<T>()
    data class Failure(val error: AppError) : Result<Nothing>()
    data object Loading : Result<Nothing>()
}
```

**async/await を使用した構造化並行性:**
```kotlin
suspend fun fetchUserWithPosts(userId: String): UserProfile =
    coroutineScope {
        val user = async { userService.getUser(userId) }
        val posts = async { postService.getUserPosts(userId) }
        UserProfile(user = user.await(), posts = posts.await())
    }
```

## コア原則

### 1. Null 安全性

Kotlin の型システムは null 可能型と非 null 型を区別します。これを最大限に活用してください。

```kotlin
// 良い例: デフォルトで非 null 型を使用
fun getUser(id: String): User {
    return userRepository.findById(id)
        ?: throw UserNotFoundException("User $id not found")
}

// 良い例: セーフコールと Elvis 演算子
fun getUserEmail(userId: String): String {
    val user = userRepository.findById(userId)
    return user?.email ?: "unknown@example.com"
}

// 悪い例: null 可能型を強制アンラップ
fun getUserEmail(userId: String): String {
    val user = userRepository.findById(userId)
    return user!!.email // null の場合 NPE をスロー
}
```

### 2. デフォルトでイミュータブル

`var` より `val` を優先し、ミュータブルコレクションよりイミュータブルコレクションを優先してください。

```kotlin
// 良い例: イミュータブルデータ
data class User(
    val id: String,
    val name: String,
    val email: String,
)

// 良い例: copy() で変換
fun updateEmail(user: User, newEmail: String): User =
    user.copy(email = newEmail)

// 良い例: イミュータブルコレクション
val users: List<User> = listOf(user1, user2)
val filtered = users.filter { it.email.isNotBlank() }

// 悪い例: ミュータブルな状態
var currentUser: User? = null // ミュータブルなグローバル状態を避ける
val mutableUsers = mutableListOf<User>() // 本当に必要な場合のみ使用
```

### 3. 式ボディと単一式関数

簡潔で読みやすい関数には式ボディを使用してください。

```kotlin
// 良い例: 式ボディ
fun isAdult(age: Int): Boolean = age >= 18

fun formatFullName(first: String, last: String): String =
    "$first $last".trim()

fun User.displayName(): String =
    name.ifBlank { email.substringBefore('@') }

// 良い例: 式としての when
fun statusMessage(code: Int): String = when (code) {
    200 -> "OK"
    404 -> "Not Found"
    500 -> "Internal Server Error"
    else -> "Unknown status: $code"
}

// 悪い例: 不要なブロックボディ
fun isAdult(age: Int): Boolean {
    return age >= 18
}
```

### 4. 値オブジェクトのためのデータクラス

主にデータを保持する型にはデータクラスを使用してください。

```kotlin
// 良い例: copy、equals、hashCode、toString を持つデータクラス
data class CreateUserRequest(
    val name: String,
    val email: String,
    val role: Role = Role.USER,
)

// 良い例: 型安全性のための値クラス（ランタイムでゼロオーバーヘッド）
@JvmInline
value class UserId(val value: String) {
    init {
        require(value.isNotBlank()) { "UserId cannot be blank" }
    }
}

@JvmInline
value class Email(val value: String) {
    init {
        require('@' in value) { "Invalid email: $value" }
    }
}

fun getUser(id: UserId): User = userRepository.findById(id)
```

## シールドクラスとインターフェース

### 制限された階層のモデリング

```kotlin
// 良い例: 網羅的な when のためのシールドクラス
sealed class Result<out T> {
    data class Success<T>(val data: T) : Result<T>()
    data class Failure(val error: AppError) : Result<Nothing>()
    data object Loading : Result<Nothing>()
}

fun <T> Result<T>.getOrNull(): T? = when (this) {
    is Result.Success -> data
    is Result.Failure -> null
    is Result.Loading -> null
}

fun <T> Result<T>.getOrThrow(): T = when (this) {
    is Result.Success -> data
    is Result.Failure -> throw error.toException()
    is Result.Loading -> throw IllegalStateException("Still loading")
}
```

### API レスポンス用シールドインターフェース

```kotlin
sealed interface ApiError {
    val message: String

    data class NotFound(override val message: String) : ApiError
    data class Unauthorized(override val message: String) : ApiError
    data class Validation(
        override val message: String,
        val field: String,
    ) : ApiError
    data class Internal(
        override val message: String,
        val cause: Throwable? = null,
    ) : ApiError
}

fun ApiError.toStatusCode(): Int = when (this) {
    is ApiError.NotFound -> 404
    is ApiError.Unauthorized -> 401
    is ApiError.Validation -> 422
    is ApiError.Internal -> 500
}
```

## スコープ関数

### それぞれの使用タイミング

```kotlin
// let: null 可能またはスコープ付き結果を変換
val length: Int? = name?.let { it.trim().length }

// apply: オブジェクトを設定する（オブジェクトを返す）
val user = User().apply {
    name = "Alice"
    email = "alice@example.com"
}

// also: 副作用（オブジェクトを返す）
val user = createUser(request).also { logger.info("Created user: ${it.id}") }

// run: レシーバーでブロックを実行（結果を返す）
val result = connection.run {
    prepareStatement(sql)
    executeQuery()
}

// with: run の非拡張形式
val csv = with(StringBuilder()) {
    appendLine("name,email")
    users.forEach { appendLine("${it.name},${it.email}") }
    toString()
}
```

### アンチパターン

```kotlin
// 悪い例: スコープ関数のネスト
user?.let { u ->
    u.address?.let { addr ->
        addr.city?.let { city ->
            println(city) // 読みにくい
        }
    }
}

// 良い例: セーフコールチェーンを使用
val city = user?.address?.city
city?.let { println(it) }
```

## 拡張関数

### 継承なしで機能を追加

```kotlin
// 良い例: ドメイン固有の拡張
fun String.toSlug(): String =
    lowercase()
        .replace(Regex("[^a-z0-9\\s-]"), "")
        .replace(Regex("\\s+"), "-")
        .trim('-')

fun Instant.toLocalDate(zone: ZoneId = ZoneId.systemDefault()): LocalDate =
    atZone(zone).toLocalDate()

// 良い例: コレクション拡張
fun <T> List<T>.second(): T = this[1]

fun <T> List<T>.secondOrNull(): T? = getOrNull(1)

// 良い例: スコープ付き拡張（グローバル名前空間を汚染しない）
class UserService {
    private fun User.isActive(): Boolean =
        status == Status.ACTIVE && lastLogin.isAfter(Instant.now().minus(30, ChronoUnit.DAYS))

    fun getActiveUsers(): List<User> = userRepository.findAll().filter { it.isActive() }
}
```

## コルーチン

### 構造化並行性

```kotlin
// 良い例: coroutineScope による構造化並行性
suspend fun fetchUserWithPosts(userId: String): UserProfile =
    coroutineScope {
        val userDeferred = async { userService.getUser(userId) }
        val postsDeferred = async { postService.getUserPosts(userId) }

        UserProfile(
            user = userDeferred.await(),
            posts = postsDeferred.await(),
        )
    }

// 良い例: 子が独立して失敗できる場合は supervisorScope
suspend fun fetchDashboard(userId: String): Dashboard =
    supervisorScope {
        val user = async { userService.getUser(userId) }
        val notifications = async { notificationService.getRecent(userId) }
        val recommendations = async { recommendationService.getFor(userId) }

        Dashboard(
            user = user.await(),
            notifications = try {
                notifications.await()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                emptyList()
            },
            recommendations = try {
                recommendations.await()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                emptyList()
            },
        )
    }
```

### リアクティブストリームのための Flow

```kotlin
// 良い例: 適切なエラーハンドリングを持つコールドフロー
fun observeUsers(): Flow<List<User>> = flow {
    while (currentCoroutineContext().isActive) {
        val users = userRepository.findAll()
        emit(users)
        delay(5.seconds)
    }
}.catch { e ->
    logger.error("Error observing users", e)
    emit(emptyList())
}

// 良い例: Flow オペレーター
fun searchUsers(query: Flow<String>): Flow<List<User>> =
    query
        .debounce(300.milliseconds)
        .distinctUntilChanged()
        .filter { it.length >= 2 }
        .mapLatest { q -> userRepository.search(q) }
        .catch { emit(emptyList()) }
```

### キャンセルとクリーンアップ

```kotlin
// 良い例: キャンセルを尊重
suspend fun processItems(items: List<Item>) {
    items.forEach { item ->
        ensureActive() // 高コストな処理の前にキャンセルを確認
        processItem(item)
    }
}

// 良い例: try/finally でクリーンアップ
suspend fun acquireAndProcess() {
    val resource = acquireResource()
    try {
        resource.process()
    } finally {
        withContext(NonCancellable) {
            resource.release() // キャンセル時でも常に解放
        }
    }
}
```

## 委譲

### プロパティ委譲

```kotlin
// 遅延初期化
val expensiveData: List<User> by lazy {
    userRepository.findAll()
}

// 監視可能なプロパティ
var name: String by Delegates.observable("initial") { _, old, new ->
    logger.info("Name changed from '$old' to '$new'")
}

// マップバックのプロパティ
class Config(private val map: Map<String, Any?>) {
    val host: String by map
    val port: Int by map
    val debug: Boolean by map
}

val config = Config(mapOf("host" to "localhost", "port" to 8080, "debug" to true))
```

### インターフェース委譲

```kotlin
// 良い例: インターフェース実装を委譲
class LoggingUserRepository(
    private val delegate: UserRepository,
    private val logger: Logger,
) : UserRepository by delegate {
    // ログを追加する必要があるものだけをオーバーライド
    override suspend fun findById(id: String): User? {
        logger.info("Finding user by id: $id")
        return delegate.findById(id).also {
            logger.info("Found user: ${it?.name ?: "null"}")
        }
    }
}
```

## DSL ビルダー

### 型安全なビルダー

```kotlin
// 良い例: @DslMarker を使用した DSL
@DslMarker
annotation class HtmlDsl

@HtmlDsl
class HTML {
    private val children = mutableListOf<Element>()

    fun head(init: Head.() -> Unit) {
        children += Head().apply(init)
    }

    fun body(init: Body.() -> Unit) {
        children += Body().apply(init)
    }

    override fun toString(): String = children.joinToString("\n")
}

fun html(init: HTML.() -> Unit): HTML = HTML().apply(init)

// 使用例
val page = html {
    head { title("My Page") }
    body {
        h1("Welcome")
        p("Hello, World!")
    }
}
```

### 設定 DSL

```kotlin
data class ServerConfig(
    val host: String = "0.0.0.0",
    val port: Int = 8080,
    val ssl: SslConfig? = null,
    val database: DatabaseConfig? = null,
)

data class SslConfig(val certPath: String, val keyPath: String)
data class DatabaseConfig(val url: String, val maxPoolSize: Int = 10)

class ServerConfigBuilder {
    var host: String = "0.0.0.0"
    var port: Int = 8080
    private var ssl: SslConfig? = null
    private var database: DatabaseConfig? = null

    fun ssl(certPath: String, keyPath: String) {
        ssl = SslConfig(certPath, keyPath)
    }

    fun database(url: String, maxPoolSize: Int = 10) {
        database = DatabaseConfig(url, maxPoolSize)
    }

    fun build(): ServerConfig = ServerConfig(host, port, ssl, database)
}

fun serverConfig(init: ServerConfigBuilder.() -> Unit): ServerConfig =
    ServerConfigBuilder().apply(init).build()

// 使用例
val config = serverConfig {
    host = "0.0.0.0"
    port = 443
    ssl("/certs/cert.pem", "/certs/key.pem")
    database("jdbc:postgresql://localhost:5432/mydb", maxPoolSize = 20)
}
```

## 遅延評価のためのシーケンス

```kotlin
// 良い例: 複数の操作を持つ大きなコレクションにはシーケンスを使用
val result = users.asSequence()
    .filter { it.isActive }
    .map { it.email }
    .filter { it.endsWith("@company.com") }
    .take(10)
    .toList()

// 良い例: 無限シーケンスを生成
val fibonacci: Sequence<Long> = sequence {
    var a = 0L
    var b = 1L
    while (true) {
        yield(a)
        val next = a + b
        a = b
        b = next
    }
}

val first20 = fibonacci.take(20).toList()
```

## Gradle Kotlin DSL

### build.gradle.kts 設定

```kotlin
// 最新バージョンの確認: https://kotlinlang.org/docs/releases.html
plugins {
    kotlin("jvm") version "2.3.10"
    kotlin("plugin.serialization") version "2.3.10"
    id("io.ktor.plugin") version "3.4.0"
    id("org.jetbrains.kotlinx.kover") version "0.9.7"
    id("io.gitlab.arturbosch.detekt") version "1.23.8"
}

group = "com.example"
version = "1.0.0"

kotlin {
    jvmToolchain(21)
}

dependencies {
    // Ktor
    implementation("io.ktor:ktor-server-core:3.4.0")
    implementation("io.ktor:ktor-server-netty:3.4.0")
    implementation("io.ktor:ktor-server-content-negotiation:3.4.0")
    implementation("io.ktor:ktor-serialization-kotlinx-json:3.4.0")

    // Exposed
    implementation("org.jetbrains.exposed:exposed-core:1.0.0")
    implementation("org.jetbrains.exposed:exposed-dao:1.0.0")
    implementation("org.jetbrains.exposed:exposed-jdbc:1.0.0")
    implementation("org.jetbrains.exposed:exposed-kotlin-datetime:1.0.0")

    // Koin
    implementation("io.insert-koin:koin-ktor:4.2.0")

    // コルーチン
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")

    // テスト
    testImplementation("io.kotest:kotest-runner-junit5:6.1.4")
    testImplementation("io.kotest:kotest-assertions-core:6.1.4")
    testImplementation("io.kotest:kotest-property:6.1.4")
    testImplementation("io.mockk:mockk:1.14.9")
    testImplementation("io.ktor:ktor-server-test-host:3.4.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}

tasks.withType<Test> {
    useJUnitPlatform()
}

detekt {
    config.setFrom(files("config/detekt/detekt.yml"))
    buildUponDefaultConfig = true
}
```

## エラーハンドリングパターン

### ドメイン操作のための Result 型

```kotlin
// 良い例: Kotlin の Result またはカスタムシールドクラスを使用
suspend fun createUser(request: CreateUserRequest): Result<User> = runCatching {
    require(request.name.isNotBlank()) { "Name cannot be blank" }
    require('@' in request.email) { "Invalid email format" }

    val user = User(
        id = UserId(UUID.randomUUID().toString()),
        name = request.name,
        email = Email(request.email),
    )
    userRepository.save(user)
    user
}

// 良い例: Result をチェーン
val displayName = createUser(request)
    .map { it.name }
    .getOrElse { "Unknown" }
```

### require、check、error

```kotlin
// 良い例: 明確なメッセージを持つ事前条件
fun withdraw(account: Account, amount: Money): Account {
    require(amount.value > 0) { "Amount must be positive: $amount" }
    check(account.balance >= amount) { "Insufficient balance: ${account.balance} < $amount" }

    return account.copy(balance = account.balance - amount)
}
```

## コレクション操作

### 慣用的なコレクション処理

```kotlin
// 良い例: チェーン操作
val activeAdminEmails: List<String> = users
    .filter { it.role == Role.ADMIN && it.isActive }
    .sortedBy { it.name }
    .map { it.email }

// 良い例: グループ化と集計
val usersByRole: Map<Role, List<User>> = users.groupBy { it.role }

val oldestByRole: Map<Role, User?> = users.groupBy { it.role }
    .mapValues { (_, users) -> users.minByOrNull { it.createdAt } }

// 良い例: マップ作成のための associate
val usersById: Map<UserId, User> = users.associateBy { it.id }

// 良い例: 分割のための partition
val (active, inactive) = users.partition { it.isActive }
```

## クイックリファレンス: Kotlin イディオム

| イディオム | 説明 |
|-----------|------|
| `val` over `var` | イミュータブル変数を優先 |
| `data class` | equals/hashCode/copy を持つ値オブジェクト用 |
| `sealed class/interface` | 制限された型階層用 |
| `value class` | ゼロオーバーヘッドの型安全ラッパー |
| 式 `when` | 網羅的なパターンマッチング |
| セーフコール `?.` | null 安全なメンバーアクセス |
| Elvis `?:` | null 可能型のデフォルト値 |
| `let`/`apply`/`also`/`run`/`with` | クリーンなコードのためのスコープ関数 |
| 拡張関数 | 継承なしで振る舞いを追加 |
| `copy()` | データクラスのイミュータブルな更新 |
| `require`/`check` | 事前条件アサーション |
| コルーチン `async`/`await` | 構造化された並行実行 |
| `Flow` | コールドリアクティブストリーム |
| `sequence` | 遅延評価 |
| 委譲 `by` | 継承なしで実装を再利用 |

## 避けるべきアンチパターン

```kotlin
// 悪い例: null 可能型を強制アンラップ
val name = user!!.name

// 悪い例: Java からのプラットフォーム型リーク
fun getLength(s: String) = s.length // 安全
fun getLength(s: String?) = s?.length ?: 0 // Java からの null を処理

// 悪い例: ミュータブルなデータクラス
data class MutableUser(var name: String, var email: String)

// 悪い例: 制御フローに例外を使用
try {
    val user = findUser(id)
} catch (e: NotFoundException) {
    // 期待されるケースに例外を使用しない
}

// 良い例: null 可能な戻り値または Result を使用
val user: User? = findUserOrNull(id)

// 悪い例: コルーチンスコープを無視
GlobalScope.launch { /* GlobalScope を避ける */ }

// 良い例: 構造化並行性を使用
coroutineScope {
    launch { /* 適切にスコープ化 */ }
}

// 悪い例: 深くネストされたスコープ関数
user?.let { u ->
    u.address?.let { a ->
        a.city?.let { c -> process(c) }
    }
}

// 良い例: 直接のセーフコールチェーン
user?.address?.city?.let { process(it) }
```

**覚えておくこと**: Kotlin のコードは簡潔かつ読みやすくあるべきです。安全性のために型システムを活用し、イミュータビリティを優先し、並行性にはコルーチンを使用してください。迷ったときはコンパイラに助けてもらいましょう。
