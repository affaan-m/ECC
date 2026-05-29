---
name: kotlin-testing
description: Patrones de pruebas Kotlin con Kotest, MockK, pruebas de coroutines, pruebas basadas en propiedades y cobertura con Kover. Sigue la metodología TDD con prácticas idiomáticas de Kotlin.
origin: ECC
---

# Patrones de Pruebas Kotlin

Patrones completos de pruebas Kotlin para escribir pruebas confiables y mantenibles siguiendo la metodología TDD con Kotest y MockK.

## Cuándo Usar

- Escribir nuevas funciones o clases Kotlin
- Agregar cobertura de pruebas a código Kotlin existente
- Implementar pruebas basadas en propiedades
- Seguir el flujo de trabajo TDD en proyectos Kotlin
- Configurar Kover para cobertura de código

## Cómo Funciona

1. **Identificar el código objetivo** — Encontrar la función, clase o módulo a probar
2. **Escribir un spec Kotest** — Elegir un estilo de spec (StringSpec, FunSpec, BehaviorSpec) acorde al alcance de la prueba
3. **Mockear dependencias** — Usar MockK para aislar la unidad bajo prueba
4. **Ejecutar pruebas (ROJO)** — Verificar que la prueba falla con el error esperado
5. **Implementar código (VERDE)** — Escribir el código mínimo para pasar la prueba
6. **Refactorizar** — Mejorar la implementación manteniendo las pruebas en verde
7. **Verificar cobertura** — Ejecutar `./gradlew koverHtmlReport` y verificar 80%+ de cobertura

## Ejemplos

Las siguientes secciones contienen ejemplos detallados y ejecutables para cada patrón de prueba:

### Referencia Rápida

- **Specs Kotest** — Ejemplos de StringSpec, FunSpec, BehaviorSpec, DescribeSpec en [Estilos de Spec Kotest](#estilos-de-spec-kotest)
- **Mocking** — Configuración de MockK, mocking de coroutines, captura de argumentos en [MockK](#mockk)
- **Flujo de trabajo TDD** — Ciclo RED/GREEN/REFACTOR completo con EmailValidator en [Flujo de Trabajo TDD para Kotlin](#flujo-de-trabajo-tdd-para-kotlin)
- **Cobertura** — Configuración de Kover y comandos en [Cobertura con Kover](#cobertura-con-kover)
- **Pruebas Ktor** — Configuración de testApplication en [Pruebas con Ktor testApplication](#pruebas-con-ktor-testapplication)

### Flujo de Trabajo TDD para Kotlin

#### El Ciclo ROJO-VERDE-REFACTORIZAR

```
ROJO        -> Escribir primero una prueba fallida
VERDE       -> Escribir el código mínimo para pasar la prueba
REFACTORIZAR -> Mejorar el código manteniendo las pruebas en verde
REPETIR     -> Continuar con el siguiente requisito
```

#### TDD Paso a Paso en Kotlin

```kotlin
// Paso 1: Definir la interfaz/firma
// EmailValidator.kt
package com.example.validator

fun validateEmail(email: String): Result<String> {
    TODO("not implemented")
}

// Paso 2: Escribir la prueba fallida (ROJO)
// EmailValidatorTest.kt
package com.example.validator

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.result.shouldBeFailure
import io.kotest.matchers.result.shouldBeSuccess

class EmailValidatorTest : StringSpec({
    "valid email returns success" {
        validateEmail("user@example.com").shouldBeSuccess("user@example.com")
    }

    "empty email returns failure" {
        validateEmail("").shouldBeFailure()
    }

    "email without @ returns failure" {
        validateEmail("userexample.com").shouldBeFailure()
    }
})

// Paso 3: Ejecutar pruebas - verificar FALLO
// $ ./gradlew test
// EmailValidatorTest > valid email returns success FAILED
//   kotlin.NotImplementedError: An operation is not implemented

// Paso 4: Implementar el código mínimo (VERDE)
fun validateEmail(email: String): Result<String> {
    if (email.isBlank()) return Result.failure(IllegalArgumentException("Email cannot be blank"))
    if ('@' !in email) return Result.failure(IllegalArgumentException("Email must contain @"))
    val regex = Regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$")
    if (!regex.matches(email)) return Result.failure(IllegalArgumentException("Invalid email format"))
    return Result.success(email)
}

// Paso 5: Ejecutar pruebas - verificar PASE
// $ ./gradlew test
// EmailValidatorTest > valid email returns success PASSED
// EmailValidatorTest > empty email returns failure PASSED
// EmailValidatorTest > email without @ returns failure PASSED

// Paso 6: Refactorizar si es necesario, verificar que las pruebas siguen pasando
```

### Estilos de Spec Kotest

#### StringSpec (El Más Simple)

```kotlin
class CalculatorTest : StringSpec({
    "add two positive numbers" {
        Calculator.add(2, 3) shouldBe 5
    }

    "add negative numbers" {
        Calculator.add(-1, -2) shouldBe -3
    }

    "add zero" {
        Calculator.add(0, 5) shouldBe 5
    }
})
```

#### FunSpec (Similar a JUnit)

```kotlin
class UserServiceTest : FunSpec({
    val repository = mockk<UserRepository>()
    val service = UserService(repository)

    test("getUser returns user when found") {
        val expected = User(id = "1", name = "Alice")
        coEvery { repository.findById("1") } returns expected

        val result = service.getUser("1")

        result shouldBe expected
    }

    test("getUser throws when not found") {
        coEvery { repository.findById("999") } returns null

        shouldThrow<UserNotFoundException> {
            service.getUser("999")
        }
    }
})
```

#### BehaviorSpec (Estilo BDD)

```kotlin
class OrderServiceTest : BehaviorSpec({
    val repository = mockk<OrderRepository>()
    val paymentService = mockk<PaymentService>()
    val service = OrderService(repository, paymentService)

    Given("a valid order request") {
        val request = CreateOrderRequest(
            userId = "user-1",
            items = listOf(OrderItem("product-1", quantity = 2)),
        )

        When("the order is placed") {
            coEvery { paymentService.charge(any()) } returns PaymentResult.Success
            coEvery { repository.save(any()) } answers { firstArg() }

            val result = service.placeOrder(request)

            Then("it should return a confirmed order") {
                result.status shouldBe OrderStatus.CONFIRMED
            }

            Then("it should charge payment") {
                coVerify(exactly = 1) { paymentService.charge(any()) }
            }
        }

        When("payment fails") {
            coEvery { paymentService.charge(any()) } returns PaymentResult.Declined

            Then("it should throw PaymentException") {
                shouldThrow<PaymentException> {
                    service.placeOrder(request)
                }
            }
        }
    }
})
```

#### DescribeSpec (Estilo RSpec)

```kotlin
class UserValidatorTest : DescribeSpec({
    describe("validateUser") {
        val validator = UserValidator()

        context("with valid input") {
            it("accepts a normal user") {
                val user = CreateUserRequest("Alice", "alice@example.com")
                validator.validate(user).shouldBeValid()
            }
        }

        context("with invalid name") {
            it("rejects blank name") {
                val user = CreateUserRequest("", "alice@example.com")
                validator.validate(user).shouldBeInvalid()
            }

            it("rejects name exceeding max length") {
                val user = CreateUserRequest("A".repeat(256), "alice@example.com")
                validator.validate(user).shouldBeInvalid()
            }
        }
    }
})
```

### Matchers de Kotest

#### Matchers Principales

```kotlin
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.*
import io.kotest.matchers.collections.*
import io.kotest.matchers.nulls.*

// Igualdad
result shouldBe expected
result shouldNotBe unexpected

// Strings
name shouldStartWith "Al"
name shouldEndWith "ice"
name shouldContain "lic"
name shouldMatch Regex("[A-Z][a-z]+")
name.shouldBeBlank()

// Colecciones
list shouldContain "item"
list shouldHaveSize 3
list.shouldBeSorted()
list.shouldContainAll("a", "b", "c")
list.shouldBeEmpty()

// Nulls
result.shouldNotBeNull()
result.shouldBeNull()

// Tipos
result.shouldBeInstanceOf<User>()

// Números
count shouldBeGreaterThan 0
price shouldBeInRange 1.0..100.0

// Excepciones
shouldThrow<IllegalArgumentException> {
    validateAge(-1)
}.message shouldBe "Age must be positive"

shouldNotThrow<Exception> {
    validateAge(25)
}
```

#### Matchers Personalizados

```kotlin
fun beActiveUser() = object : Matcher<User> {
    override fun test(value: User) = MatcherResult(
        value.isActive && value.lastLogin != null,
        { "User ${value.id} should be active with a last login" },
        { "User ${value.id} should not be active" },
    )
}

// Uso
user should beActiveUser()
```

### MockK

#### Mocking Básico

```kotlin
class UserServiceTest : FunSpec({
    val repository = mockk<UserRepository>()
    val logger = mockk<Logger>(relaxed = true) // Relaxed: retorna valores por defecto
    val service = UserService(repository, logger)

    beforeTest {
        clearMocks(repository, logger)
    }

    test("findUser delegates to repository") {
        val expected = User(id = "1", name = "Alice")
        every { repository.findById("1") } returns expected

        val result = service.findUser("1")

        result shouldBe expected
        verify(exactly = 1) { repository.findById("1") }
    }

    test("findUser returns null for unknown id") {
        every { repository.findById(any()) } returns null

        val result = service.findUser("unknown")

        result.shouldBeNull()
    }
})
```

#### Mocking de Coroutines

```kotlin
class AsyncUserServiceTest : FunSpec({
    val repository = mockk<UserRepository>()
    val service = UserService(repository)

    test("getUser suspending function") {
        coEvery { repository.findById("1") } returns User(id = "1", name = "Alice")

        val result = service.getUser("1")

        result.name shouldBe "Alice"
        coVerify { repository.findById("1") }
    }

    test("getUser with delay") {
        coEvery { repository.findById("1") } coAnswers {
            delay(100) // Simular trabajo asíncrono
            User(id = "1", name = "Alice")
        }

        val result = service.getUser("1")
        result.name shouldBe "Alice"
    }
})
```

#### Captura de Argumentos

```kotlin
test("save captures the user argument") {
    val slot = slot<User>()
    coEvery { repository.save(capture(slot)) } returns Unit

    service.createUser(CreateUserRequest("Alice", "alice@example.com"))

    slot.captured.name shouldBe "Alice"
    slot.captured.email shouldBe "alice@example.com"
    slot.captured.id.shouldNotBeNull()
}
```

#### Spy y Mocking Parcial

```kotlin
test("spy on real object") {
    val realService = UserService(repository)
    val spy = spyk(realService)

    every { spy.generateId() } returns "fixed-id"

    spy.createUser(request)

    verify { spy.generateId() } // Sobreescrito
    // Otros métodos usan la implementación real
}
```

### Pruebas de Coroutines

#### runTest para Funciones Suspend

```kotlin
import kotlinx.coroutines.test.runTest

class CoroutineServiceTest : FunSpec({
    test("concurrent fetches complete together") {
        runTest {
            val service = DataService(testScope = this)

            val result = service.fetchAllData()

            result.users.shouldNotBeEmpty()
            result.products.shouldNotBeEmpty()
        }
    }

    test("timeout after delay") {
        runTest {
            val service = SlowService()

            shouldThrow<TimeoutCancellationException> {
                withTimeout(100) {
                    service.slowOperation() // Tarda > 100ms
                }
            }
        }
    }
})
```

#### Pruebas de Flows

```kotlin
import io.kotest.matchers.collections.shouldContainInOrder
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest

class FlowServiceTest : FunSpec({
    test("observeUsers emits updates") {
        runTest {
            val service = UserFlowService()

            val emissions = service.observeUsers()
                .take(3)
                .toList()

            emissions shouldHaveSize 3
            emissions.last().shouldNotBeEmpty()
        }
    }

    test("searchUsers debounces input") {
        runTest {
            val service = SearchService()
            val queries = MutableSharedFlow<String>()

            val results = mutableListOf<List<User>>()
            val job = launch {
                service.searchUsers(queries).collect { results.add(it) }
            }

            queries.emit("a")
            queries.emit("ab")
            queries.emit("abc") // Solo este debería disparar la búsqueda
            advanceTimeBy(500)

            results shouldHaveSize 1
            job.cancel()
        }
    }
})
```

#### TestDispatcher

```kotlin
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle

class DispatcherTest : FunSpec({
    test("uses test dispatcher for controlled execution") {
        val dispatcher = StandardTestDispatcher()

        runTest(dispatcher) {
            var completed = false

            launch {
                delay(1000)
                completed = true
            }

            completed shouldBe false
            advanceTimeBy(1000)
            completed shouldBe true
        }
    }
})
```

### Pruebas Basadas en Propiedades

#### Pruebas de Propiedades con Kotest

```kotlin
import io.kotest.core.spec.style.FunSpec
import io.kotest.property.Arb
import io.kotest.property.arbitrary.*
import io.kotest.property.forAll
import io.kotest.property.checkAll
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString

// Nota: La prueba de roundtrip de serialización requiere que la data class User
// esté anotada con @Serializable (de kotlinx.serialization).

class PropertyTest : FunSpec({
    test("string reverse is involutory") {
        forAll<String> { s ->
            s.reversed().reversed() == s
        }
    }

    test("list sort is idempotent") {
        forAll(Arb.list(Arb.int())) { list ->
            list.sorted() == list.sorted().sorted()
        }
    }

    test("serialization roundtrip preserves data") {
        checkAll(Arb.bind(Arb.string(1..50), Arb.string(5..100)) { name, email ->
            User(name = name, email = "$email@test.com")
        }) { user ->
            val json = Json.encodeToString(user)
            val decoded = Json.decodeFromString<User>(json)
            decoded shouldBe user
        }
    }
})
```

#### Generadores Personalizados

```kotlin
val userArb: Arb<User> = Arb.bind(
    Arb.string(minSize = 1, maxSize = 50),
    Arb.email(),
    Arb.enum<Role>(),
) { name, email, role ->
    User(
        id = UserId(UUID.randomUUID().toString()),
        name = name,
        email = Email(email),
        role = role,
    )
}

val moneyArb: Arb<Money> = Arb.bind(
    Arb.long(1L..1_000_000L),
    Arb.enum<Currency>(),
) { amount, currency ->
    Money(amount, currency)
}
```

### Pruebas Dirigidas por Datos

#### withData en Kotest

```kotlin
class ParserTest : FunSpec({
    context("parsing valid dates") {
        withData(
            "2026-01-15" to LocalDate(2026, 1, 15),
            "2026-12-31" to LocalDate(2026, 12, 31),
            "2000-01-01" to LocalDate(2000, 1, 1),
        ) { (input, expected) ->
            parseDate(input) shouldBe expected
        }
    }

    context("rejecting invalid dates") {
        withData(
            nameFn = { "rejects '$it'" },
            "not-a-date",
            "2026-13-01",
            "2026-00-15",
            "",
        ) { input ->
            shouldThrow<DateParseException> {
                parseDate(input)
            }
        }
    }
})
```

### Ciclo de Vida y Fixtures de Prueba

#### BeforeTest / AfterTest

```kotlin
class DatabaseTest : FunSpec({
    lateinit var db: Database

    beforeSpec {
        db = Database.connect("jdbc:h2:mem:test;DB_CLOSE_DELAY=-1")
        transaction(db) {
            SchemaUtils.create(UsersTable)
        }
    }

    afterSpec {
        transaction(db) {
            SchemaUtils.drop(UsersTable)
        }
    }

    beforeTest {
        transaction(db) {
            UsersTable.deleteAll()
        }
    }

    test("insert and retrieve user") {
        transaction(db) {
            UsersTable.insert {
                it[name] = "Alice"
                it[email] = "alice@example.com"
            }
        }

        val users = transaction(db) {
            UsersTable.selectAll().map { it[UsersTable.name] }
        }

        users shouldContain "Alice"
    }
})
```

#### Extensiones de Kotest

```kotlin
// Extensión de prueba reutilizable
class DatabaseExtension : BeforeSpecListener, AfterSpecListener {
    lateinit var db: Database

    override suspend fun beforeSpec(spec: Spec) {
        db = Database.connect("jdbc:h2:mem:test;DB_CLOSE_DELAY=-1")
    }

    override suspend fun afterSpec(spec: Spec) {
        // limpieza
    }
}

class UserRepositoryTest : FunSpec({
    val dbExt = DatabaseExtension()
    register(dbExt)

    test("save and find user") {
        val repo = UserRepository(dbExt.db)
        // ...
    }
})
```

### Cobertura con Kover

#### Configuración de Gradle

```kotlin
// build.gradle.kts
plugins {
    id("org.jetbrains.kotlinx.kover") version "0.9.7"
}

kover {
    reports {
        total {
            html { onCheck = true }
            xml { onCheck = true }
        }
        filters {
            excludes {
                classes("*.generated.*", "*.config.*")
            }
        }
        verify {
            rule {
                minBound(80) // Fallar el build por debajo del 80% de cobertura
            }
        }
    }
}
```

#### Comandos de Cobertura

```bash
# Ejecutar pruebas con cobertura
./gradlew koverHtmlReport

# Verificar umbrales de cobertura
./gradlew koverVerify

# Reporte XML para CI
./gradlew koverXmlReport

# Ver reporte HTML (usa el comando para tu SO)
# macOS:   open build/reports/kover/html/index.html
# Linux:   xdg-open build/reports/kover/html/index.html
# Windows: start build/reports/kover/html/index.html
```

#### Objetivos de Cobertura

| Tipo de Código | Objetivo |
|----------------|----------|
| Lógica de negocio crítica | 100% |
| APIs públicas | 90%+ |
| Código general | 80%+ |
| Código generado / configuración | Excluir |

### Pruebas con Ktor testApplication

```kotlin
class ApiRoutesTest : FunSpec({
    test("GET /users returns list") {
        testApplication {
            application {
                configureRouting()
                configureSerialization()
            }

            val response = client.get("/users")

            response.status shouldBe HttpStatusCode.OK
            val users = response.body<List<UserResponse>>()
            users.shouldNotBeEmpty()
        }
    }

    test("POST /users creates user") {
        testApplication {
            application {
                configureRouting()
                configureSerialization()
            }

            val response = client.post("/users") {
                contentType(ContentType.Application.Json)
                setBody(CreateUserRequest("Alice", "alice@example.com"))
            }

            response.status shouldBe HttpStatusCode.Created
        }
    }
})
```

### Comandos de Prueba

```bash
# Ejecutar todas las pruebas
./gradlew test

# Ejecutar clase de prueba específica
./gradlew test --tests "com.example.UserServiceTest"

# Ejecutar prueba específica
./gradlew test --tests "com.example.UserServiceTest.getUser returns user when found"

# Ejecutar con salida detallada
./gradlew test --info

# Ejecutar con cobertura
./gradlew koverHtmlReport

# Ejecutar detekt (análisis estático)
./gradlew detekt

# Ejecutar ktlint (verificación de formato)
./gradlew ktlintCheck

# Pruebas continuas
./gradlew test --continuous
```

### Buenas Prácticas

**HACER:**
- Escribir pruebas PRIMERO (TDD)
- Usar los estilos de spec de Kotest de forma consistente en el proyecto
- Usar `coEvery`/`coVerify` de MockK para funciones suspend
- Usar `runTest` para pruebas de coroutines
- Probar comportamiento, no implementación
- Usar pruebas basadas en propiedades para funciones puras
- Usar fixtures de `data class` para mayor claridad

**NO HACER:**
- Mezclar frameworks de prueba (elegir Kotest y mantenerlo)
- Mockear data classes (usar instancias reales)
- Usar `Thread.sleep()` en pruebas de coroutines (usar `advanceTimeBy`)
- Saltarse la fase ROJA en TDD
- Probar funciones privadas directamente
- Ignorar pruebas inestables (flaky tests)

### Integración con CI/CD

```yaml
# Ejemplo de GitHub Actions
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-java@v4
      with:
        distribution: 'temurin'
        java-version: '21'

    - name: Run tests with coverage
      run: ./gradlew test koverXmlReport

    - name: Verify coverage
      run: ./gradlew koverVerify

    - name: Upload coverage
      uses: codecov/codecov-action@v5
      with:
        files: build/reports/kover/report.xml
        token: ${{ secrets.CODECOV_TOKEN }}
```

**Recuerda**: Las pruebas son documentación. Muestran cómo debe usarse tu código Kotlin. Usa los matchers expresivos de Kotest para que las pruebas sean legibles y MockK para un mocking limpio de dependencias.
