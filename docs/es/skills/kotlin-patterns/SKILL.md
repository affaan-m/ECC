---
name: kotlin-patterns
description: Patrones idiomáticos de Kotlin, buenas prácticas y convenciones para construir aplicaciones Kotlin robustas, eficientes y mantenibles con coroutines, null safety y builders de DSL.
origin: ECC
---

# Patrones de Desarrollo Kotlin

Patrones idiomáticos de Kotlin y buenas prácticas para construir aplicaciones robustas, eficientes y mantenibles.

## Cuándo Usar

- Escribir nuevo código Kotlin
- Revisar código Kotlin
- Refactorizar código Kotlin existente
- Diseñar módulos o librerías Kotlin
- Configurar builds con Gradle Kotlin DSL

## Cómo Funciona

Este skill aplica convenciones idiomáticas de Kotlin en siete áreas clave: null safety usando el sistema de tipos y operadores de llamada segura, inmutabilidad mediante `val` y `copy()` en data classes, clases selladas e interfaces para jerarquías de tipos exhaustivas, concurrencia estructurada con coroutines y `Flow`, funciones de extensión para agregar comportamiento sin herencia, builders de DSL type-safe usando `@DslMarker` y receptores lambda, y Gradle Kotlin DSL para configuración de build.

## Ejemplos

**Null safety con el operador Elvis:**
```kotlin
fun getUserEmail(userId: String): String {
    val user = userRepository.findById(userId)
    return user?.email ?: "unknown@example.com"
}
```

**Sealed class para resultados exhaustivos:**
```kotlin
sealed class Result<out T> {
    data class Success<T>(val data: T) : Result<T>()
    data class Failure(val error: AppError) : Result<Nothing>()
    data object Loading : Result<Nothing>()
}
```

**Concurrencia estructurada con async/await:**
```kotlin
suspend fun fetchUserWithPosts(userId: String): UserProfile =
    coroutineScope {
        val user = async { userService.getUser(userId) }
        val posts = async { postService.getUserPosts(userId) }
        UserProfile(user = user.await(), posts = posts.await())
    }
```

## Principios Fundamentales

### 1. Null Safety

El sistema de tipos de Kotlin distingue tipos nullable de no-nullable. Aprovecharlo al máximo.

```kotlin
// Bien: Usar tipos no-nullable por defecto
fun getUser(id: String): User {
    return userRepository.findById(id)
        ?: throw UserNotFoundException("User $id not found")
}

// Bien: Llamadas seguras y operador Elvis
fun getUserEmail(userId: String): String {
    val user = userRepository.findById(userId)
    return user?.email ?: "unknown@example.com"
}

// Mal: Desempaquetar forzadamente tipos nullable
fun getUserEmail(userId: String): String {
    val user = userRepository.findById(userId)
    return user!!.email // Lanza NPE si es null
}
```

### 2. Inmutabilidad por Defecto

Preferir `val` sobre `var`, colecciones inmutables sobre mutables.

```kotlin
// Bien: Datos inmutables
data class User(
    val id: String,
    val name: String,
    val email: String,
)

// Bien: Transformar con copy()
fun updateEmail(user: User, newEmail: String): User =
    user.copy(email = newEmail)

// Bien: Colecciones inmutables
val users: List<User> = listOf(user1, user2)
val filtered = users.filter { it.email.isNotBlank() }

// Mal: Estado mutable
var currentUser: User? = null // Evitar estado global mutable
val mutableUsers = mutableListOf<User>() // Evitar a menos que sea realmente necesario
```

### 3. Cuerpos de Expresión y Funciones de Una Sola Expresión

Usar cuerpos de expresión para funciones concisas y legibles.

```kotlin
// Bien: Cuerpo de expresión
fun isAdult(age: Int): Boolean = age >= 18

fun formatFullName(first: String, last: String): String =
    "$first $last".trim()

fun User.displayName(): String =
    name.ifBlank { email.substringBefore('@') }

// Bien: When como expresión
fun statusMessage(code: Int): String = when (code) {
    200 -> "OK"
    404 -> "Not Found"
    500 -> "Internal Server Error"
    else -> "Unknown status: $code"
}

// Mal: Cuerpo de bloque innecesario
fun isAdult(age: Int): Boolean {
    return age >= 18
}
```

### 4. Data Classes para Objetos de Valor

Usar data classes para tipos que principalmente contienen datos.

```kotlin
// Bien: Data class con copy, equals, hashCode, toString
data class CreateUserRequest(
    val name: String,
    val email: String,
    val role: Role = Role.USER,
)

// Bien: Value class para type safety (cero overhead en tiempo de ejecución)
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

## Clases Selladas e Interfaces

### Modelar Jerarquías Restringidas

```kotlin
// Bien: Sealed class para when exhaustivo
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

### Sealed Interfaces para Respuestas de API

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

## Funciones de Scope

### Cuándo Usar Cada Una

```kotlin
// let: Transformar resultado nullable o delimitado
val length: Int? = name?.let { it.trim().length }

// apply: Configurar un objeto (retorna el objeto)
val user = User().apply {
    name = "Alice"
    email = "alice@example.com"
}

// also: Efectos secundarios (retorna el objeto)
val user = createUser(request).also { logger.info("Created user: ${it.id}") }

// run: Ejecutar un bloque con receptor (retorna resultado)
val result = connection.run {
    prepareStatement(sql)
    executeQuery()
}

// with: Forma no-extensión de run
val csv = with(StringBuilder()) {
    appendLine("name,email")
    users.forEach { appendLine("${it.name},${it.email}") }
    toString()
}
```

### Anti-Patrones

```kotlin
// Mal: Anidar funciones de scope
user?.let { u ->
    u.address?.let { addr ->
        addr.city?.let { city ->
            println(city) // Difícil de leer
        }
    }
}

// Bien: Encadenar llamadas seguras en su lugar
val city = user?.address?.city
city?.let { println(it) }
```

## Funciones de Extensión

### Agregar Funcionalidad Sin Herencia

```kotlin
// Bien: Extensiones específicas del dominio
fun String.toSlug(): String =
    lowercase()
        .replace(Regex("[^a-z0-9\\s-]"), "")
        .replace(Regex("\\s+"), "-")
        .trim('-')

fun Instant.toLocalDate(zone: ZoneId = ZoneId.systemDefault()): LocalDate =
    atZone(zone).toLocalDate()

// Bien: Extensiones de colecciones
fun <T> List<T>.second(): T = this[1]

fun <T> List<T>.secondOrNull(): T? = getOrNull(1)

// Bien: Extensiones delimitadas (sin contaminar el namespace global)
class UserService {
    private fun User.isActive(): Boolean =
        status == Status.ACTIVE && lastLogin.isAfter(Instant.now().minus(30, ChronoUnit.DAYS))

    fun getActiveUsers(): List<User> = userRepository.findAll().filter { it.isActive() }
}
```

## Coroutines

### Concurrencia Estructurada

```kotlin
// Bien: Concurrencia estructurada con coroutineScope
suspend fun fetchUserWithPosts(userId: String): UserProfile =
    coroutineScope {
        val userDeferred = async { userService.getUser(userId) }
        val postsDeferred = async { postService.getUserPosts(userId) }

        UserProfile(
            user = userDeferred.await(),
            posts = postsDeferred.await(),
        )
    }

// Bien: supervisorScope cuando los hijos pueden fallar independientemente
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

### Flow para Streams Reactivos

```kotlin
// Bien: Flow frío con manejo de errores adecuado
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

// Bien: Operadores de Flow
fun searchUsers(query: Flow<String>): Flow<List<User>> =
    query
        .debounce(300.milliseconds)
        .distinctUntilChanged()
        .filter { it.length >= 2 }
        .mapLatest { q -> userRepository.search(q) }
        .catch { emit(emptyList()) }
```

### Cancelación y Limpieza

```kotlin
// Bien: Respetar la cancelación
suspend fun processItems(items: List<Item>) {
    items.forEach { item ->
        ensureActive() // Verificar cancelación antes del trabajo costoso
        processItem(item)
    }
}

// Bien: Limpieza con try/finally
suspend fun acquireAndProcess() {
    val resource = acquireResource()
    try {
        resource.process()
    } finally {
        withContext(NonCancellable) {
            resource.release() // Siempre liberar, incluso al cancelar
        }
    }
}
```

## Delegación

### Delegación de Propiedades

```kotlin
// Inicialización diferida
val expensiveData: List<User> by lazy {
    userRepository.findAll()
}

// Propiedad observable
var name: String by Delegates.observable("initial") { _, old, new ->
    logger.info("Name changed from '$old' to '$new'")
}

// Propiedades respaldadas por Map
class Config(private val map: Map<String, Any?>) {
    val host: String by map
    val port: Int by map
    val debug: Boolean by map
}

val config = Config(mapOf("host" to "localhost", "port" to 8080, "debug" to true))
```

### Delegación de Interfaces

```kotlin
// Bien: Delegar implementación de interfaz
class LoggingUserRepository(
    private val delegate: UserRepository,
    private val logger: Logger,
) : UserRepository by delegate {
    // Solo sobreescribir lo que necesitas agregar logging
    override suspend fun findById(id: String): User? {
        logger.info("Finding user by id: $id")
        return delegate.findById(id).also {
            logger.info("Found user: ${it?.name ?: "null"}")
        }
    }
}
```

## Builders de DSL

### Builders Type-Safe

```kotlin
// Bien: DSL con @DslMarker
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

// Uso
val page = html {
    head { title("My Page") }
    body {
        h1("Welcome")
        p("Hello, World!")
    }
}
```

### DSL de Configuración

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

// Uso
val config = serverConfig {
    host = "0.0.0.0"
    port = 443
    ssl("/certs/cert.pem", "/certs/key.pem")
    database("jdbc:postgresql://localhost:5432/mydb", maxPoolSize = 20)
}
```

## Secuencias para Evaluación Diferida

```kotlin
// Bien: Usar secuencias para colecciones grandes con múltiples operaciones
val result = users.asSequence()
    .filter { it.isActive }
    .map { it.email }
    .filter { it.endsWith("@company.com") }
    .take(10)
    .toList()

// Bien: Generar secuencias infinitas
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

### Configuración de build.gradle.kts

```kotlin
// Verificar las últimas versiones: https://kotlinlang.org/docs/releases.html
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

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")

    // Pruebas
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

## Patrones de Manejo de Errores

### Tipo Result para Operaciones de Dominio

```kotlin
// Bien: Usar Result de Kotlin o una sealed class personalizada
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

// Bien: Encadenar resultados
val displayName = createUser(request)
    .map { it.name }
    .getOrElse { "Unknown" }
```

### require, check, error

```kotlin
// Bien: Precondiciones con mensajes claros
fun withdraw(account: Account, amount: Money): Account {
    require(amount.value > 0) { "Amount must be positive: $amount" }
    check(account.balance >= amount) { "Insufficient balance: ${account.balance} < $amount" }

    return account.copy(balance = account.balance - amount)
}
```

## Operaciones de Colecciones

### Procesamiento Idiomático de Colecciones

```kotlin
// Bien: Operaciones encadenadas
val activeAdminEmails: List<String> = users
    .filter { it.role == Role.ADMIN && it.isActive }
    .sortedBy { it.name }
    .map { it.email }

// Bien: Agrupación y agregación
val usersByRole: Map<Role, List<User>> = users.groupBy { it.role }

val oldestByRole: Map<Role, User?> = users.groupBy { it.role }
    .mapValues { (_, users) -> users.minByOrNull { it.createdAt } }

// Bien: Associate para creación de maps
val usersById: Map<UserId, User> = users.associateBy { it.id }

// Bien: Partition para dividir
val (active, inactive) = users.partition { it.isActive }
```

## Referencia Rápida: Modismos de Kotlin

| Modismo | Descripción |
|---------|-------------|
| `val` sobre `var` | Preferir variables inmutables |
| `data class` | Para objetos de valor con equals/hashCode/copy |
| `sealed class/interface` | Para jerarquías de tipos restringidas |
| `value class` | Para wrappers type-safe con cero overhead |
| `when` expresión | Pattern matching exhaustivo |
| Llamada segura `?.` | Acceso a miembros null-safe |
| Elvis `?:` | Valor por defecto para nullables |
| `let`/`apply`/`also`/`run`/`with` | Funciones de scope para código limpio |
| Funciones de extensión | Agregar comportamiento sin herencia |
| `copy()` | Actualizaciones inmutables en data classes |
| `require`/`check` | Aserciones de precondiciones |
| Coroutine `async`/`await` | Ejecución concurrente estructurada |
| `Flow` | Streams reactivos fríos |
| `sequence` | Evaluación diferida |
| Delegación `by` | Reutilizar implementación sin herencia |

## Anti-Patrones a Evitar

```kotlin
// Mal: Desempaquetar forzadamente tipos nullable
val name = user!!.name

// Mal: Fuga de tipos de plataforma desde Java
fun getLength(s: String) = s.length // Seguro
fun getLength(s: String?) = s?.length ?: 0 // Manejar nulls de Java

// Mal: Data classes mutables
data class MutableUser(var name: String, var email: String)

// Mal: Usar excepciones para control de flujo
try {
    val user = findUser(id)
} catch (e: NotFoundException) {
    // No usar excepciones para casos esperados
}

// Bien: Usar retorno nullable o Result
val user: User? = findUserOrNull(id)

// Mal: Ignorar el scope de coroutine
GlobalScope.launch { /* Evitar GlobalScope */ }

// Bien: Usar concurrencia estructurada
coroutineScope {
    launch { /* Correctamente delimitado */ }
}

// Mal: Funciones de scope profundamente anidadas
user?.let { u ->
    u.address?.let { a ->
        a.city?.let { c -> process(c) }
    }
}

// Bien: Cadena null-safe directa
user?.address?.city?.let { process(it) }
```

**Recuerda**: El código Kotlin debe ser conciso pero legible. Aprovecha el sistema de tipos para seguridad, prefiere la inmutabilidad y usa coroutines para concurrencia. Ante la duda, deja que el compilador te ayude.
