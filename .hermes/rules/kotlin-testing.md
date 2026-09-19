---
paths:
  - "**/*.kt"
  - "**/*.kts"
---
# Kotlin Testing

> This file extends [common/testing.md](../common/testing.md) with Kotlin and Android/KMP-specific content.

## Test Framework

- **kotlin.test** for multiplatform (KMP) — `@Test`, `assertEquals`, `assertTrue`
- **JUnit 4/5** for Android-specific tests
- **Turbine** for testing Flows and StateFlow
- **kotlinx-coroutines-test** for coroutine testing (`runTest`, `TestDispatcher`)

## ViewModel Testing with Turbine

```kotlin
@Test
fun `loading state emitted then data`() = runTest {
    val repo = FakeItemRepository()
    repo.addItem(testItem)
    val viewModel = ItemListViewModel(GetItemsUseCase(repo))

    viewModel.state.test {
        assertEquals(ItemListState(), awaitItem())     // initial state
        viewModel.onEvent(ItemListEvent.Load)
        assertTrue(awaitItem().isLoading)               // loading
        assertEquals(listOf(testItem), awaitItem().items) // loaded
    }
}
```

## Fakes Over Mocks

Prefer hand-written fakes over mocking frameworks:

```kotlin
class FakeItemRepository : ItemRepository {
    private val items = mutableListOf<Item>()
    var fetchError: Throwable? = null

    override suspend fun getAll(): Result<List<Item>> {
        fetchError?.let { return Result.failure(it) }
        return Result.success(items.toList())
    }

    override fun observeAll(): Flow<List<Item>> = flowOf(items.toList())

    fun addItem(item: Item) { items.add(item) }
}
```

## Coroutine Testing

```kotlin
@Test
fun `parallel operations complete`() = runTest {
    val repo = FakeRepository()
    val result = loadDashboard(repo)
    advanceUntilIdle()
    assertNotNull(result.items)
    assertNotNull(result.stats)
}
```

Use `runTest` — it auto-advances virtual time and provides `TestScope`.

## Ktor MockEngine

```kotlin
val mockEngine = MockEngine { request ->
    when (request.url.encodedPath) {
        "/api/items" -> respond(
            content = Json.encodeToString(testItems),
            headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString())
        )
        else -> respondError(HttpStatusCode.NotFound)
    }
}

val client = HttpClient(mockEngine) {
    install(ContentNegotiation) { json() }
}
```

## Room/SQLDelight Testing

- Room: Use `Room.inMemoryDatabaseBuilder()` for in-memory testing
- SQLDelight: Use `JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)` for JVM tests

```kotlin
@Test
fun `insert and query items`() = runTest {
    val driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
    Database.Schema.create(driver)
    val db = Database(driver)

    db.itemQueries.insert("1", "Sample Item", "description")
    val items = db.itemQueries.getAll().executeAsList()
    assertEquals(1, items.size)
}
```

## Test Naming

Use backtick-quoted descriptive names:

```kotlin
@Test
fun `search with empty query returns all items`() = runTest { }

@Test
fun `delete item emits updated list without deleted item`() = runTest { }
```

## Test Organization

```
src/
├── commonTest/kotlin/     # Shared tests (ViewModel, UseCase, Repository)
├── androidUnitTest/kotlin/ # Android unit tests (JUnit)
├── androidInstrumentedTest/kotlin/  # Instrumented tests (Room, UI)
└── iosTest/kotlin/        # iOS-specific tests
```

Minimum test coverage: ViewModel + UseCase for every feature.
