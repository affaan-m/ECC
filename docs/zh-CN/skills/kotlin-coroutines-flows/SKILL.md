---
name: kotlin-coroutines-flows
description: Kotlin协程与Flow在Android和KMP中的模式——结构化并发、Flow操作符、StateFlow、错误处理和测试。
origin: ECC
---

# Kotlin 协程与 Flow

适用于 Android 和 Kotlin 多平台项目的结构化并发模式、基于 Flow 的响应式流以及协程测试。

## 何时启用

* 使用 Kotlin 协程编写异步代码
* 使用 Flow、StateFlow 或 SharedFlow 实现响应式数据
* 处理并发操作（并行加载、防抖、重试）
* 测试协程和 Flow
* 管理协程作用域与取消

## 结构化并发

### 作用域层级

```
Application
  └── viewModelScope (ViewModel)
        └── coroutineScope { } (结构化子作用域)
              ├── async { } (并发任务)
              └── async { } (并发任务)
```

始终使用结构化并发——绝不使用 `GlobalScope`：

```kotlin
// BAD
GlobalScope.launch { fetchData() }

// GOOD — scoped to ViewModel lifecycle
viewModelScope.launch { fetchData() }

// GOOD — scoped to composable lifecycle
LaunchedEffect(key) { fetchData() }
```

### 并行分解

使用 `coroutineScope` + `async` 处理并行工作：

```kotlin
suspend fun loadDashboard(): Dashboard = coroutineScope {
    val items = async { itemRepository.getRecent() }
    val stats = async { statsRepository.getToday() }
    val profile = async { userRepository.getCurrent() }
    Dashboard(
        items = items.await(),
        stats = stats.await(),
        profile = profile.await()
    )
}
```

### SupervisorScope

当子协程失败不应取消同级协程时，使用 `supervisorScope`：

```kotlin
suspend fun syncAll() = supervisorScope {
    launch { syncItems() }       // failure here won't cancel syncStats
    launch { syncStats() }
    launch { syncSettings() }
}
```

## Flow 模式

### Cold Flow —— 一次性操作到流的转换

```kotlin
fun observeItems(): Flow<List<Item>> = flow {
    // Re-emits whenever the database changes
    itemDao.observeAll()
        .map { entities -> entities.map { it.toDomain() } }
        .collect { emit(it) }
}
```

### 用于 UI 状态的 StateFlow

```kotlin
class DashboardViewModel(
    observeProgress: ObserveUserProgressUseCase
) : ViewModel() {
    val progress: StateFlow<UserProgress> = observeProgress()
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = UserProgress.EMPTY
        )
}
```

`WhileSubscribed(5_000)` 会在最后一个订阅者离开后，保持上游活动 5 秒——可在配置更改时存活而无需重启。

### 组合多个 Flow

```kotlin
val uiState: StateFlow<HomeState> = combine(
    itemRepository.observeItems(),
    settingsRepository.observeTheme(),
    userRepository.observeProfile()
) { items, theme, profile ->
    HomeState(items = items, theme = theme, profile = profile)
}.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeState())
```

### Flow 操作符

```kotlin
// Debounce search input
searchQuery
    .debounce(300)
    .distinctUntilChanged()
    .flatMapLatest { query -> repository.search(query) }
    .catch { emit(emptyList()) }
    .collect { results -> _state.update { it.copy(results = results) } }

// Retry with exponential backoff
fun fetchWithRetry(): Flow<Data> = flow { emit(api.fetch()) }
    .retryWhen { cause, attempt ->
        if (cause is IOException && attempt < 3) {
            delay(1000L * (1 shl attempt.toInt()))
            true
        } else {
            false
        }
    }
```

### 用于一次性事件的 SharedFlow

```kotlin
class ItemListViewModel : ViewModel() {
    private val _effects = MutableSharedFlow<Effect>()
    val effects: SharedFlow<Effect> = _effects.asSharedFlow()

    sealed interface Effect {
        data class ShowSnackbar(val message: String) : Effect
        data class NavigateTo(val route: String) : Effect
    }

    private fun deleteItem(id: String) {
        viewModelScope.launch {
            repository.delete(id)
            _effects.emit(Effect.ShowSnackbar("Item deleted"))
        }
    }
}

// Collect in Composable
LaunchedEffect(Unit) {
    viewModel.effects.collect { effect ->
        when (effect) {
            is Effect.ShowSnackbar -> snackbarHostState.showSnackbar(effect.message)
            is Effect.NavigateTo -> navController.navigate(effect.route)
        }
    }
}
```

## 调度器

```kotlin
// CPU-intensive work
withContext(Dispatchers.Default) { parseJson(largePayload) }

// IO-bound work
withContext(Dispatchers.IO) { database.query() }

// Main thread (UI) — default in viewModelScope
withContext(Dispatchers.Main) { updateUi() }
```

在 KMP 中，使用 `Dispatchers.Default` 和 `Dispatchers.Main`（在所有平台上可用）。`Dispatchers.IO` 仅适用于 JVM/Android——在其他平台上使用 `Dispatchers.Default` 或通过依赖注入提供。

## 取消

### 协作式取消

长时间运行的循环必须检查取消状态：

```kotlin
suspend fun processItems(items: List<Item>) = coroutineScope {
    for (item in items) {
        ensureActive()  // throws CancellationException if cancelled
        process(item)
    }
}
```

### 使用 try/finally 进行清理

```kotlin
viewModelScope.launch {
    try {
        _state.update { it.copy(isLoading = true) }
        val data = repository.fetch()
        _state.update { it.copy(data = data) }
    } finally {
        _state.update { it.copy(isLoading = false) }  // always runs, even on cancellation
    }
}
```

## 测试

### 使用 Turbine 测试 StateFlow

```kotlin
@Test
fun `search updates item list`() = runTest {
    val fakeRepository = FakeItemRepository().apply { emit(testItems) }
    val viewModel = ItemListViewModel(GetItemsUseCase(fakeRepository))

    viewModel.state.test {
        assertEquals(ItemListState(), awaitItem())  // initial

        viewModel.onSearch("query")
        val loading = awaitItem()
        assertTrue(loading.isLoading)

        val loaded = awaitItem()
        assertFalse(loaded.isLoading)
        assertEquals(1, loaded.items.size)
    }
}
```

### 使用 TestDispatcher 测试

```kotlin
@Test
fun `parallel load completes correctly`() = runTest {
    val viewModel = DashboardViewModel(
        itemRepo = FakeItemRepo(),
        statsRepo = FakeStatsRepo()
    )

    viewModel.load()
    advanceUntilIdle()

    val state = viewModel.state.value
    assertNotNull(state.items)
    assertNotNull(state.stats)
}
```

### 模拟 Flow

```kotlin
class FakeItemRepository : ItemRepository {
    private val _items = MutableStateFlow<List<Item>>(emptyList())

    override fun observeItems(): Flow<List<Item>> = _items

    fun emit(items: List<Item>) { _items.value = items }

    override suspend fun getItemsByCategory(category: String): Result<List<Item>> {
        return Result.success(_items.value.filter { it.category == category })
    }
}
```

## 应避免的反模式

* 使用 `GlobalScope`——会导致协程泄漏，且无法结构化取消
* 在没有作用域的情况下于 `init {}` 中收集 Flow——应使用 `viewModelScope.launch`
* 将 `MutableStateFlow` 与可变集合一起使用——始终使用不可变副本：`_state.update { it.copy(list = it.list + newItem) }`
* 捕获 `CancellationException`——应让其传播以实现正确的取消
* 使用 `flowOn(Dispatchers.Main)` 进行收集——收集调度器是调用方的调度器
* 在 `@Composable` 中创建 `Flow` 而不使用 `remember`——每次重组都会重新创建 Flow

## 参考

关于 Flow 在 UI 层的消费，请参阅技能：`compose-multiplatform-patterns`。
关于协程在各层中的适用位置，请参阅技能：`android-clean-architecture`。
