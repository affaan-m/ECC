---
name: kotlin-ktor-patterns
description: Ktor サーバーパターン（ルーティング DSL、プラグイン、認証、Koin DI、kotlinx.serialization、WebSocket、testApplication テストを含む）。
origin: ECC
---

# Ktor サーバーパターン

Kotlin コルーチンで堅牢かつ保守性の高い HTTP サーバーを構築するための包括的な Ktor パターン。

## アクティベートするタイミング

- Ktor HTTP サーバーの構築
- Ktor プラグインの設定（Auth、CORS、ContentNegotiation、StatusPages）
- Ktor を使用した REST API の実装
- Koin を使用した依存性注入の設定
- testApplication を使用した Ktor インテグレーションテストの作成
- Ktor での WebSocket の使用

## アプリケーション構造

### 標準的な Ktor プロジェクトレイアウト

```text
src/main/kotlin/
├── com/example/
│   ├── Application.kt           # エントリーポイント、モジュール設定
│   ├── plugins/
│   │   ├── Routing.kt           # ルート定義
│   │   ├── Serialization.kt     # コンテントネゴシエーション設定
│   │   ├── Authentication.kt    # 認証設定
│   │   ├── StatusPages.kt       # エラーハンドリング
│   │   └── CORS.kt              # CORS 設定
│   ├── routes/
│   │   ├── UserRoutes.kt        # /users エンドポイント
│   │   ├── AuthRoutes.kt        # /auth エンドポイント
│   │   └── HealthRoutes.kt      # /health エンドポイント
│   ├── models/
│   │   ├── User.kt              # ドメインモデル
│   │   └── ApiResponse.kt       # レスポンスエンベロープ
│   ├── services/
│   │   ├── UserService.kt       # ビジネスロジック
│   │   └── AuthService.kt       # 認証ロジック
│   ├── repositories/
│   │   ├── UserRepository.kt    # データアクセスインターフェース
│   │   └── ExposedUserRepository.kt
│   └── di/
│       └── AppModule.kt         # Koin モジュール
src/test/kotlin/
├── com/example/
│   ├── routes/
│   │   └── UserRoutesTest.kt
│   └── services/
│       └── UserServiceTest.kt
```

### アプリケーションエントリーポイント

```kotlin
// Application.kt
fun main() {
    embeddedServer(Netty, port = 8080, module = Application::module).start(wait = true)
}

fun Application.module() {
    configureSerialization()
    configureAuthentication()
    configureStatusPages()
    configureCORS()
    configureDI()
    configureRouting()
}
```

## ルーティング DSL

### 基本ルート

```kotlin
// plugins/Routing.kt
fun Application.configureRouting() {
    routing {
        userRoutes()
        authRoutes()
        healthRoutes()
    }
}

// routes/UserRoutes.kt
fun Route.userRoutes() {
    val userService by inject<UserService>()

    route("/users") {
        get {
            val users = userService.getAll()
            call.respond(users)
        }

        get("/{id}") {
            val id = call.parameters["id"]
                ?: return@get call.respond(HttpStatusCode.BadRequest, "Missing id")
            val user = userService.getById(id)
                ?: return@get call.respond(HttpStatusCode.NotFound)
            call.respond(user)
        }

        post {
            val request = call.receive<CreateUserRequest>()
            val user = userService.create(request)
            call.respond(HttpStatusCode.Created, user)
        }

        put("/{id}") {
            val id = call.parameters["id"]
                ?: return@put call.respond(HttpStatusCode.BadRequest, "Missing id")
            val request = call.receive<UpdateUserRequest>()
            val user = userService.update(id, request)
                ?: return@put call.respond(HttpStatusCode.NotFound)
            call.respond(user)
        }

        delete("/{id}") {
            val id = call.parameters["id"]
                ?: return@delete call.respond(HttpStatusCode.BadRequest, "Missing id")
            val deleted = userService.delete(id)
            if (deleted) call.respond(HttpStatusCode.NoContent)
            else call.respond(HttpStatusCode.NotFound)
        }
    }
}
```

### 認証ルートを使用したルート整理

```kotlin
fun Route.userRoutes() {
    route("/users") {
        // パブリックルート
        get { /* ユーザー一覧 */ }
        get("/{id}") { /* ユーザー取得 */ }

        // 保護されたルート
        authenticate("jwt") {
            post { /* ユーザー作成 - 認証が必要 */ }
            put("/{id}") { /* ユーザー更新 - 認証が必要 */ }
            delete("/{id}") { /* ユーザー削除 - 認証が必要 */ }
        }
    }
}
```

## コンテントネゴシエーションとシリアライゼーション

### kotlinx.serialization セットアップ

```kotlin
// plugins/Serialization.kt
fun Application.configureSerialization() {
    install(ContentNegotiation) {
        json(Json {
            prettyPrint = true
            isLenient = false
            ignoreUnknownKeys = true
            encodeDefaults = true
            explicitNulls = false
        })
    }
}
```

### シリアライズ可能なモデル

```kotlin
@Serializable
data class UserResponse(
    val id: String,
    val name: String,
    val email: String,
    val role: Role,
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant,
)

@Serializable
data class CreateUserRequest(
    val name: String,
    val email: String,
    val role: Role = Role.USER,
)

@Serializable
data class ApiResponse<T>(
    val success: Boolean,
    val data: T? = null,
    val error: String? = null,
) {
    companion object {
        fun <T> ok(data: T): ApiResponse<T> = ApiResponse(success = true, data = data)
        fun <T> error(message: String): ApiResponse<T> = ApiResponse(success = false, error = message)
    }
}

@Serializable
data class PaginatedResponse<T>(
    val data: List<T>,
    val total: Long,
    val page: Int,
    val limit: Int,
)
```

### カスタムシリアライザー

```kotlin
object InstantSerializer : KSerializer<Instant> {
    override val descriptor = PrimitiveSerialDescriptor("Instant", PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: Instant) =
        encoder.encodeString(value.toString())
    override fun deserialize(decoder: Decoder): Instant =
        Instant.parse(decoder.decodeString())
}
```

## 認証

### JWT 認証

```kotlin
// plugins/Authentication.kt
fun Application.configureAuthentication() {
    val jwtSecret = environment.config.property("jwt.secret").getString()
    val jwtIssuer = environment.config.property("jwt.issuer").getString()
    val jwtAudience = environment.config.property("jwt.audience").getString()
    val jwtRealm = environment.config.property("jwt.realm").getString()

    install(Authentication) {
        jwt("jwt") {
            realm = jwtRealm
            verifier(
                JWT.require(Algorithm.HMAC256(jwtSecret))
                    .withAudience(jwtAudience)
                    .withIssuer(jwtIssuer)
                    .build()
            )
            validate { credential ->
                if (credential.payload.audience.contains(jwtAudience)) {
                    JWTPrincipal(credential.payload)
                } else {
                    null
                }
            }
            challenge { _, _ ->
                call.respond(HttpStatusCode.Unauthorized, ApiResponse.error<Unit>("Invalid or expired token"))
            }
        }
    }
}

// JWT からユーザーを取得
fun ApplicationCall.userId(): String =
    principal<JWTPrincipal>()
        ?.payload
        ?.getClaim("userId")
        ?.asString()
        ?: throw AuthenticationException("No userId in token")
```

### 認証ルート

```kotlin
fun Route.authRoutes() {
    val authService by inject<AuthService>()

    route("/auth") {
        post("/login") {
            val request = call.receive<LoginRequest>()
            val token = authService.login(request.email, request.password)
                ?: return@post call.respond(
                    HttpStatusCode.Unauthorized,
                    ApiResponse.error<Unit>("Invalid credentials"),
                )
            call.respond(ApiResponse.ok(TokenResponse(token)))
        }

        post("/register") {
            val request = call.receive<RegisterRequest>()
            val user = authService.register(request)
            call.respond(HttpStatusCode.Created, ApiResponse.ok(user))
        }

        authenticate("jwt") {
            get("/me") {
                val userId = call.userId()
                val user = authService.getProfile(userId)
                call.respond(ApiResponse.ok(user))
            }
        }
    }
}
```

## StatusPages（エラーハンドリング）

```kotlin
// plugins/StatusPages.kt
fun Application.configureStatusPages() {
    install(StatusPages) {
        exception<ContentTransformationException> { call, cause ->
            call.respond(
                HttpStatusCode.BadRequest,
                ApiResponse.error<Unit>("Invalid request body: ${cause.message}"),
            )
        }

        exception<IllegalArgumentException> { call, cause ->
            call.respond(
                HttpStatusCode.BadRequest,
                ApiResponse.error<Unit>(cause.message ?: "Bad request"),
            )
        }

        exception<AuthenticationException> { call, _ ->
            call.respond(
                HttpStatusCode.Unauthorized,
                ApiResponse.error<Unit>("Authentication required"),
            )
        }

        exception<AuthorizationException> { call, _ ->
            call.respond(
                HttpStatusCode.Forbidden,
                ApiResponse.error<Unit>("Access denied"),
            )
        }

        exception<NotFoundException> { call, cause ->
            call.respond(
                HttpStatusCode.NotFound,
                ApiResponse.error<Unit>(cause.message ?: "Resource not found"),
            )
        }

        exception<Throwable> { call, cause ->
            call.application.log.error("Unhandled exception", cause)
            call.respond(
                HttpStatusCode.InternalServerError,
                ApiResponse.error<Unit>("Internal server error"),
            )
        }

        status(HttpStatusCode.NotFound) { call, status ->
            call.respond(status, ApiResponse.error<Unit>("Route not found"))
        }
    }
}
```

## CORS 設定

```kotlin
// plugins/CORS.kt
fun Application.configureCORS() {
    install(CORS) {
        allowHost("localhost:3000")
        allowHost("example.com", schemes = listOf("https"))
        allowHeader(HttpHeaders.ContentType)
        allowHeader(HttpHeaders.Authorization)
        allowMethod(HttpMethod.Put)
        allowMethod(HttpMethod.Delete)
        allowMethod(HttpMethod.Patch)
        allowCredentials = true
        maxAgeInSeconds = 3600
    }
}
```

## Koin 依存性注入

### モジュール定義

```kotlin
// di/AppModule.kt
val appModule = module {
    // データベース
    single<Database> { DatabaseFactory.create(get()) }

    // リポジトリ
    single<UserRepository> { ExposedUserRepository(get()) }
    single<OrderRepository> { ExposedOrderRepository(get()) }

    // サービス
    single { UserService(get()) }
    single { OrderService(get(), get()) }
    single { AuthService(get(), get()) }
}

// アプリケーションセットアップ
fun Application.configureDI() {
    install(Koin) {
        modules(appModule)
    }
}
```

### ルートでの Koin の使用

```kotlin
fun Route.userRoutes() {
    val userService by inject<UserService>()

    route("/users") {
        get {
            val users = userService.getAll()
            call.respond(ApiResponse.ok(users))
        }
    }
}
```

### テスト用の Koin

```kotlin
class UserServiceTest : FunSpec(), KoinTest {
    override fun extensions() = listOf(KoinExtension(testModule))

    private val testModule = module {
        single<UserRepository> { mockk() }
        single { UserService(get()) }
    }

    private val repository by inject<UserRepository>()
    private val service by inject<UserService>()

    init {
        test("getUser returns user") {
            coEvery { repository.findById("1") } returns testUser
            service.getById("1") shouldBe testUser
        }
    }
}
```

## リクエストバリデーション

```kotlin
// ルートでリクエストデータを検証
fun Route.userRoutes() {
    val userService by inject<UserService>()

    post("/users") {
        val request = call.receive<CreateUserRequest>()

        // バリデーション
        require(request.name.isNotBlank()) { "Name is required" }
        require(request.name.length <= 100) { "Name must be 100 characters or less" }
        require(request.email.matches(Regex(".+@.+\\..+"))) { "Invalid email format" }

        val user = userService.create(request)
        call.respond(HttpStatusCode.Created, ApiResponse.ok(user))
    }
}

// またはバリデーション拡張を使用
fun CreateUserRequest.validate() {
    require(name.isNotBlank()) { "Name is required" }
    require(name.length <= 100) { "Name must be 100 characters or less" }
    require(email.matches(Regex(".+@.+\\..+"))) { "Invalid email format" }
}
```

## WebSocket

```kotlin
fun Application.configureWebSockets() {
    install(WebSockets) {
        pingPeriod = 15.seconds
        timeout = 15.seconds
        maxFrameSize = 64 * 1024 // 64 KiB — プロトコルがより大きなフレームを必要とする場合のみ増加
        masking = false // RFC 6455 に従い、サーバーからクライアントへのフレームはマスクなし。クライアントからサーバーは Ktor が常にマスク
    }
}

fun Route.chatRoutes() {
    val connections = Collections.synchronizedSet<Connection>(LinkedHashSet())

    webSocket("/chat") {
        val thisConnection = Connection(this)
        connections += thisConnection

        try {
            send("Connected! Users online: ${connections.size}")

            for (frame in incoming) {
                frame as? Frame.Text ?: continue
                val text = frame.readText()
                val message = ChatMessage(thisConnection.name, text)

                // ConcurrentModificationException を避けるためにロック下でスナップショットを作成
                val snapshot = synchronized(connections) { connections.toList() }
                snapshot.forEach { conn ->
                    conn.session.send(Json.encodeToString(message))
                }
            }
        } catch (e: Exception) {
            logger.error("WebSocket error", e)
        } finally {
            connections -= thisConnection
        }
    }
}

data class Connection(val session: DefaultWebSocketSession) {
    val name: String = "User-${counter.getAndIncrement()}"

    companion object {
        private val counter = AtomicInteger(0)
    }
}
```

## testApplication テスト

### 基本的なルートテスト

```kotlin
class UserRoutesTest : FunSpec({
    test("GET /users returns list of users") {
        testApplication {
            application {
                install(Koin) { modules(testModule) }
                configureSerialization()
                configureRouting()
            }

            val response = client.get("/users")

            response.status shouldBe HttpStatusCode.OK
            val body = response.body<ApiResponse<List<UserResponse>>>()
            body.success shouldBe true
            body.data.shouldNotBeNull().shouldNotBeEmpty()
        }
    }

    test("POST /users creates a user") {
        testApplication {
            application {
                install(Koin) { modules(testModule) }
                configureSerialization()
                configureStatusPages()
                configureRouting()
            }

            val client = createClient {
                install(io.ktor.client.plugins.contentnegotiation.ContentNegotiation) {
                    json()
                }
            }

            val response = client.post("/users") {
                contentType(ContentType.Application.Json)
                setBody(CreateUserRequest("Alice", "alice@example.com"))
            }

            response.status shouldBe HttpStatusCode.Created
        }
    }

    test("GET /users/{id} returns 404 for unknown id") {
        testApplication {
            application {
                install(Koin) { modules(testModule) }
                configureSerialization()
                configureStatusPages()
                configureRouting()
            }

            val response = client.get("/users/unknown-id")

            response.status shouldBe HttpStatusCode.NotFound
        }
    }
})
```

### 認証ルートのテスト

```kotlin
class AuthenticatedRoutesTest : FunSpec({
    test("protected route requires JWT") {
        testApplication {
            application {
                install(Koin) { modules(testModule) }
                configureSerialization()
                configureAuthentication()
                configureRouting()
            }

            val response = client.post("/users") {
                contentType(ContentType.Application.Json)
                setBody(CreateUserRequest("Alice", "alice@example.com"))
            }

            response.status shouldBe HttpStatusCode.Unauthorized
        }
    }

    test("protected route succeeds with valid JWT") {
        testApplication {
            application {
                install(Koin) { modules(testModule) }
                configureSerialization()
                configureAuthentication()
                configureRouting()
            }

            val token = generateTestJWT(userId = "test-user")

            val client = createClient {
                install(io.ktor.client.plugins.contentnegotiation.ContentNegotiation) { json() }
            }

            val response = client.post("/users") {
                contentType(ContentType.Application.Json)
                bearerAuth(token)
                setBody(CreateUserRequest("Alice", "alice@example.com"))
            }

            response.status shouldBe HttpStatusCode.Created
        }
    }
})
```

## 設定

### application.yaml

```yaml
ktor:
  application:
    modules:
      - com.example.ApplicationKt.module
  deployment:
    port: 8080

jwt:
  secret: ${JWT_SECRET}
  issuer: "https://example.com"
  audience: "https://example.com/api"
  realm: "example"

database:
  url: ${DATABASE_URL}
  driver: "org.postgresql.Driver"
  maxPoolSize: 10
```

### 設定の読み取り

```kotlin
fun Application.configureDI() {
    val dbUrl = environment.config.property("database.url").getString()
    val dbDriver = environment.config.property("database.driver").getString()
    val maxPoolSize = environment.config.property("database.maxPoolSize").getString().toInt()

    install(Koin) {
        modules(module {
            single { DatabaseConfig(dbUrl, dbDriver, maxPoolSize) }
            single { DatabaseFactory.create(get()) }
        })
    }
}
```

## クイックリファレンス: Ktor パターン

| パターン | 説明 |
|---------|------|
| `route("/path") { get { } }` | DSL を使用したルートグループ化 |
| `call.receive<T>()` | リクエストボディのデシリアライズ |
| `call.respond(status, body)` | ステータス付きレスポンスの送信 |
| `call.parameters["id"]` | パスパラメーターの読み取り |
| `call.request.queryParameters["q"]` | クエリパラメーターの読み取り |
| `install(Plugin) { }` | プラグインのインストールと設定 |
| `authenticate("name") { }` | 認証でルートを保護 |
| `by inject<T>()` | Koin 依存性注入 |
| `testApplication { }` | インテグレーションテスト |

**覚えておくこと**: Ktor は Kotlin コルーチンと DSL を中心に設計されています。ルートをシンプルに保ち、ロジックはサービスに移し、依存性注入には Koin を使用してください。完全なインテグレーションカバレッジのために `testApplication` でテストしてください。
