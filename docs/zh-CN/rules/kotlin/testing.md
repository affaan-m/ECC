---
paths:
  - "**/*.kt"
  - "**/*.kts"
---

# Kotlin 测试

> 本文档扩展了 [common/testing.md](../common/testing.md)，补充了 Kotlin 和 Android/KMP 特有的内容。

## 测试框架

* **kotlin.test** 用于跨平台 (KMP) — `@Test`, `assertEquals`, `assertTrue`
* **JUnit 4/5** 用于 Android 特定测试
* **Turbine** 用于测试 Flow 和 StateFlow
* **kotlinx-coroutines-test** 用于协程测试 (`runTest`, `TestDispatcher`)

## 使用 Turbine 测试 ViewModel

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

## 使用伪造对象而非模拟对象

优先使用手写的伪造对象，而非模拟框架：

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

## 协程测试

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

使用 `runTest` — 它会自动推进虚拟时间并提供 `TestScope`。

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

## Room/SQLDelight 测试

* Room: 使用 `Room.inMemoryDatabaseBuilder()` 进行内存测试
* SQLDelight: 在 JVM 测试中使用 `JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)`

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

## 测试命名

使用反引号包裹的描述性名称：

```kotlin
@Test
fun `search with empty query returns all items`() = runTest { }

@Test
fun `delete item emits updated list without deleted item`() = runTest { }
```

## 测试组织

```
src/
├── commonTest/kotlin/     # 共享测试（ViewModel、UseCase、Repository）
├── androidUnitTest/kotlin/ # Android 单元测试（JUnit）
├── androidInstrumentedTest/kotlin/  # 仪器化测试（Room、UI）
└── iosTest/kotlin/        # iOS 专用测试
```

最低测试覆盖率：每个功能都需要覆盖 ViewModel + UseCase。
