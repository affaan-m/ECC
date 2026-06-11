---
name: kotlin-ktor-patterns
description: Ktor server patterns including routing DSL, plugins, authentication, Koin DI, kotlinx.serialization, WebSockets, and testApplication testing.
origin: ECC
---

# Ktor Server Patterns

Comprehensive Ktor patterns for building robust, maintainable HTTP servers with Kotlin coroutines.

## When to Activate

- Building Ktor HTTP servers
- Configuring Ktor plugins (Auth, CORS, ContentNegotiation, StatusPages)
- Implementing REST APIs with Ktor
- Setting up dependency injection with Koin
- Writing Ktor integration tests with testApplication
- Working with WebSockets in Ktor

## Application Structure

### Standard Ktor Project Layout

```text
src/main/kotlin/
├── com/example/
│   ├── Application.kt           # Entry point, module configuration
│   ├── plugins/
│   │   ├── Routing.kt           # Route definitions
│   │   ├── Serialization.kt     # Content negotiation setup
│   │   ├── Authentication.kt    # Auth configuration
│   │   ├── StatusPages.kt       # Error handling
│   │   └── CORS.kt              # CORS configuration
│   ├── routes/
│   │   ├── UserRoutes.kt        # /users endpoints
│   │   ├── AuthRoutes.kt        # /auth endpoints
│   │   └── HealthRoutes.kt      # /health endpoints
│   ├── models/
│   │   ├── User.kt              # Domain models
│   │   └── ApiResponse.kt       # Response envelopes
│   ├── services/
│   │   ├── UserService.kt       # Business logic
│   │   └── AuthService.kt       # Auth logic
│   ├── repositories/
│   │   ├── UserRepository.kt    # Data access interface
│   │   └── ExposedUserRepository.kt
│   └── di/
│       └── AppModule.kt         # Koin modules
src/test/kotlin/
├── com/example/
│   ├── routes/
│   │   └── UserRoutesTest.kt
│   └── services/
│       └── UserServiceTest.kt
```

### Application Entry Point

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

## Routing DSL

### Basic Routes

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

### Route Organization with Authenticated Routes

```kotlin
fun Route.userRoutes() {
    route("/users") {
        // Public routes
        get { /* list users */ }
        get("/{id}") { /* get user */ }

        // Protected routes
        authenticate("jwt") {
            post { /* create user - requires auth */ }
            put("/{id}") { /* update user - requires auth */ }
            delete("/{id}") { /* delete user - requires auth */ }
        }
    }
}
```

## Content Negotiation & Serialization

### kotlinx.serialization Setup

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

### Serializable Models

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

### Custom Serializers

```kotlin
object InstantSerializer : KSerializer<Instant> {
    override val descriptor = PrimitiveSerialDescriptor("Instant", PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: Instant) =
        encoder.encodeString(value.toString())
    override fun deserialize(decoder: Decoder): Instant =
        Instant.parse(decoder.decodeString())
}
```

## Authentication

### JWT Authentication

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

// Extracting user from JWT
fun ApplicationCall.userId(): String =
    principal<JWTPrincipal>()
        ?.payload
        ?.getClaim("userId")
        ?.asString()
        ?: throw AuthenticationException("No userId in token")
```

### Auth Routes

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

## Status Pages (Error Handling)

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

## CORS Configuration

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

## Koin Dependency Injection

### Module Definition

```kotlin
// di/AppModule.kt
val appModule = module {
    // Database
    single<Database> { DatabaseFactory.create(get()) }

    // Repositories
    single<UserRepository> { ExposedUserRepository(get()) }
    single<OrderRepository> { ExposedOrderRepository(get()) }

    // Services
    single { UserService(get()) }
    single { OrderService(get(), get()) }
    single { AuthService(get(), get()) }
}

// Application setup
fun Application.configureDI() {
    install(Koin) {
        modules(appModule)
    }
}
```

### Using Koin in Routes

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

### Koin for Testing

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

## Request Validation

```kotlin
// Validate request data in routes
fun Route.userRoutes() {
    val userService by inject<UserService>()

    post("/users") {
        val request = call.receive<CreateUserRequest>()

        // Validate
        require(request.name.isNotBlank()) { "Name is required" }
        require(request.name.length <= 100) { "Name must be 100 characters or less" }
        require(request.email.matches(Regex(".+@.+\\..+"))) { "Invalid email format" }

        val user = userService.create(request)
        call.respond(HttpStatusCode.Created, ApiResponse.ok(user))
    }
}

// Or use a validation extension
fun CreateUserRequest.validate() {
    require(name.isNotBlank()) { "Name is required" }
    require(name.length <= 100) { "Name must be 100 characters or less" }
    require(email.matches(Regex(".+@.+\\..+"))) { "Invalid email format" }
}
```

## WebSockets

```kotlin
fun Application.configureWebSockets() {
    install(WebSockets) {
        pingPeriod = 15.seconds
        timeout = 15.seconds
        maxFrameSize = 64 * 1024 // 64 KiB — increase only if your protocol requires larger frames
        masking = false // Server-to-client frames are unmasked per RFC 6455; client-to-server are always masked by Ktor
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

                // Snapshot under lock to avoid ConcurrentModificationException
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

## testApplication Testing

### Basic Route Testing

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

### Testing Authenticated Routes

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

## Configuration

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

### Reading Config

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

## Quick Reference: Ktor Patterns

| Pattern | Description |
|---------|-------------|
| `route("/path") { get { } }` | Route grouping with DSL |
| `call.receive<T>()` | Deserialize request body |
| `call.respond(status, body)` | Send response with status |
| `call.parameters["id"]` | Read path parameters |
| `call.request.queryParameters["q"]` | Read query parameters |
| `install(Plugin) { }` | Install and configure plugin |
| `authenticate("name") { }` | Protect routes with auth |
| `by inject<T>()` | Koin dependency injection |
| `testApplication { }` | Integration testing |

**Remember**: Ktor is designed around Kotlin coroutines and DSLs. Keep routes thin, push logic to services, and use Koin for dependency injection. Test with `testApplication` for full integration coverage.
