---
name: kotlin-testing
description: Kotest, MockK, coroutine testi, property-based testing ve Kover coverage ile Kotlin test kalıpları. İdiomatic Kotlin uygulamalarıyla TDD metodolojisini takip eder.
origin: ECC
---

# Kotlin Test Kalıpları

Kotest ve MockK ile TDD metodolojisini takip ederek güvenilir, sürdürülebilir testler yazmak için kapsamlı Kotlin test kalıpları.

## Ne Zaman Kullanılır

- Yeni Kotlin fonksiyonları veya class'lar yazarken
- Mevcut Kotlin koduna test coverage eklerken
- Property-based testler uygularken
- Kotlin projelerinde TDD iş akışını takip ederken
- Kod coverage için Kover yapılandırırken

## Nasıl Çalışır

1. **Hedef kodu belirle** — Test edilecek fonksiyon, class veya modülü bul
2. **Kotest spec yaz** — Test scope'una uygun bir spec stili seç (StringSpec, FunSpec, BehaviorSpec)
3. **Bağımlılıkları mock'la** — Test edilen birimi izole etmek için MockK kullan
4. **Testleri çalıştır (RED)** — Testin beklenen hatayla başarısız olduğunu doğrula
5. **Kodu uygula (GREEN)** — Testi geçmek için minimal kod yaz
6. **Refactor** — Testleri yeşil tutarken implementasyonu iyileştir
7. **Coverage'ı kontrol et** — `./gradlew koverHtmlReport` çalıştır ve %80+ coverage'ı doğrula

## TDD İş Akışı for Kotlin

### RED-GREEN-REFACTOR Döngüsü

```
RED     -> Önce başarısız bir test yaz
GREEN   -> Testi geçmek için minimal kod yaz
REFACTOR -> Testleri yeşil tutarken kodu iyileştir
REPEAT  -> Sonraki gereksinimle devam et
```

### Kotlin'de Adım Adım TDD

```kotlin
// Adım 1: Interface/signature tanımla
// EmailValidator.kt
package com.example.validator

fun validateEmail(email: String): Result<String> {
    TODO("not implemented")
}

// Adım 2: Başarısız test yaz (RED)
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

// Adım 3: Testleri çalıştır - FAIL doğrula
// $ ./gradlew test
// EmailValidatorTest > valid email returns success FAILED
//   kotlin.NotImplementedError: An operation is not implemented

// Adım 4: Minimal kodu uygula (GREEN)
fun validateEmail(email: String): Result<String> {
    if (email.isBlank()) return Result.failure(IllegalArgumentException("Email cannot be blank"))
    if ('@' !in email) return Result.failure(IllegalArgumentException("Email must contain @"))
    val regex = Regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$")
    if (!regex.matches(email)) return Result.failure(IllegalArgumentException("Invalid email format"))
    return Result.success(email)
}

// Adım 5: Testleri çalıştır - PASS doğrula
// $ ./gradlew test
// EmailValidatorTest > valid email returns success PASSED
// EmailValidatorTest > empty email returns failure PASSED
// EmailValidatorTest > email without @ returns failure PASSED

// Adım 6: Gerekirse refactor et, testlerin hala geçtiğini doğrula
```

## Kotest Spec Stilleri

### StringSpec (En Basit)

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

### FunSpec (JUnit benzeri)

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

### BehaviorSpec (BDD Stili)

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

## Kotest Matcher'lar

### Temel Matcher'lar

```kotlin
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.*
import io.kotest.matchers.collections.*
import io.kotest.matchers.nulls.*

// Eşitlik
result shouldBe expected
result shouldNotBe unexpected

// String'ler
name shouldStartWith "Al"
name shouldEndWith "ice"
name shouldContain "lic"
name shouldMatch Regex("[A-Z][a-z]+")
name.shouldBeBlank()

// Koleksiyonlar
list shouldContain "item"
list shouldHaveSize 3
list.shouldBeSorted()
list.shouldContainAll("a", "b", "c")
list.shouldBeEmpty()

// Null'lar
result.shouldNotBeNull()
result.shouldBeNull()

// Tipler
result.shouldBeInstanceOf<User>()

// Sayılar
count shouldBeGreaterThan 0
price shouldBeInRange 1.0..100.0

// Exception'lar
shouldThrow<IllegalArgumentException> {
    validateAge(-1)
}.message shouldBe "Age must be positive"

shouldNotThrow<Exception> {
    validateAge(25)
}
```

## MockK

### Temel Mocking

```kotlin
class UserServiceTest : FunSpec({
    val repository = mockk<UserRepository>()
    val logger = mockk<Logger>(relaxed = true) // Relaxed: varsayılanları döndürür
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

### Coroutine Mocking

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
            delay(100) // Async çalışmayı simüle et
            User(id = "1", name = "Alice")
        }

        val result = service.getUser("1")
        result.name shouldBe "Alice"
    }
})
```

## Coroutine Testi

### Suspend Fonksiyonlar İçin runTest

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
                    service.slowOperation() // > 100ms sürer
                }
            }
        }
    }
})
```

### Flow Testi

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
            queries.emit("abc") // Sadece bu aramayı tetiklemeli
            advanceTimeBy(500)

            results shouldHaveSize 1
            job.cancel()
        }
    }
})
```

## Property-Based Testing

### Kotest Property Testing

```kotlin
import io.kotest.core.spec.style.FunSpec
import io.kotest.property.Arb
import io.kotest.property.arbitrary.*
import io.kotest.property.forAll
import io.kotest.property.checkAll

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

## Kover Coverage

### Gradle Yapılandırması

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
                minBound(80) // %80 coverage'ın altında build başarısız
            }
        }
    }
}
```

### Coverage Komutları

```bash
# Testleri coverage ile çalıştır
./gradlew koverHtmlReport

# Coverage eşiklerini doğrula
./gradlew koverVerify

# CI için XML raporu
./gradlew koverXmlReport

# HTML raporunu görüntüle (OS'nize göre komutu kullanın)
# macOS:   open build/reports/kover/html/index.html
# Linux:   xdg-open build/reports/kover/html/index.html
# Windows: start build/reports/kover/html/index.html
```

### Coverage Hedefleri

| Kod Tipi | Hedef |
|-----------|--------|
| Kritik business mantığı | %100 |
| Public API'ler | %90+ |
| Genel kod | %80+ |
| Generated / config kodu | Hariç tut |

## Ktor testApplication Testi

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

## Test Komutları

```bash
# Tüm testleri çalıştır
./gradlew test

# Belirli test class'ını çalıştır
./gradlew test --tests "com.example.UserServiceTest"

# Belirli testi çalıştır
./gradlew test --tests "com.example.UserServiceTest.getUser returns user when found"

# Verbose çıktı ile çalıştır
./gradlew test --info

# Coverage ile çalıştır
./gradlew koverHtmlReport

# Detekt çalıştır (statik analiz)
./gradlew detekt

# Ktlint çalıştır (formatlama kontrolü)
./gradlew ktlintCheck

# Sürekli test
./gradlew test --continuous
```

## En İyi Uygulamalar

**YAPILMASI GEREKENLER:**
- ÖNCE testleri yaz (TDD)
- Proje genelinde Kotest'in spec stillerini tutarlı kullan
- Suspend fonksiyonlar için MockK'nın `coEvery`/`coVerify`'ını kullan
- Coroutine testi için `runTest` kullan
- İmplementasyon değil davranışı test et
- Pure fonksiyonlar için property-based testing kullan
- Netlik için `data class` test fixture'ları kullan

**YAPILMAMASI GEREKENLER:**
- Test framework'lerini karıştırma (Kotest seç ve ona sadık kal)
- Data class'ları mock'lama (gerçek instance'lar kullan)
- Coroutine testlerinde `Thread.sleep()` kullanma (`advanceTimeBy` kullan)
- TDD'de RED fazını atlama
- Private fonksiyonları doğrudan test etme
- Kararsız testleri görmezden gelme

## CI/CD ile Entegrasyon

```yaml
# GitHub Actions örneği
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

**Hatırla**: Testler dokümantasyondur. Kotlin kodunuzun nasıl kullanılması gerektiğini gösterirler. Testleri okunabilir yapmak için Kotest'in açıklayıcı matcher'larını ve bağımlılıkları temiz mock'lamak için MockK kullanın.
