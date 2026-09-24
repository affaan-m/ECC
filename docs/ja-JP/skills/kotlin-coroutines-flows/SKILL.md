---
name: kotlin-coroutines-flows
description: Android および KMP 向けの Kotlin コルーチンと Flow パターン — 構造化並行性、Flow オペレーター、StateFlow、エラーハンドリング、テスト。
origin: ECC
---

# Kotlin コルーチン & Flow

Android および Kotlin Multiplatform プロジェクトにおける構造化並行性、Flow ベースのリアクティブストリーム、コルーチンテストのパターン。

## アクティベートするタイミング

- Kotlin コルーチンで非同期コードを書く
- リアクティブデータに Flow、StateFlow、または SharedFlow を使用する
- 並行操作を処理する（並列読み込み、デバウンス、リトライ）
- コルーチンと Flow をテストする
- コルーチンスコープとキャンセルを管理する

## 構造化並行性

### スコープ階層

```
Application
  └── viewModelScope (ViewModel)
        └── coroutineScope { } (構造化された子)
              ├── async { } (並行タスク)
              └── async { } (並行タスク)
```

常に構造化並行性を使用してください — `GlobalScope` は絶対に使わない:

```kotlin
// NG
GlobalScope.launch { fetchData() }

// OK — ViewModel ライフサイクルにスコープ
viewModelScope.launch { fetchData() }

// OK — コンポーザブルライフサイクルにスコープ
LaunchedEffect(key) { fetchData() }
```

### 並列分解

並列作業には `coroutineScope` + `async` を使用:

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

子の失敗が兄弟をキャンセルしてはならない場合は `supervisorScope` を使用:

```kotlin
suspend fun syncAll() = supervisorScope {
    launch { syncItems() }       // ここでの失敗は syncStats をキャンセルしない
    launch { syncStats() }
    launch { syncSettings() }
}
```

## Flow パターン

### コールドフロー — ワンショットからストリームへの変換

```kotlin
fun observeItems(): Flow<List<Item>> = flow {
    // データベースが変更されるたびに再エミット
    itemDao.observeAll()
        .map { entities -> entities.map { it.toDomain() } }
        .collect { emit(it) }
}
```

### UI 状態のための StateFlow

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

`WhileSubscribed(5_000)` は最後のサブスクライバーが離れてから 5 秒間アップストリームをアクティブに保ちます — 設定変更を再起動なしに生き延びます。

### 複数の Flow の結合

```kotlin
val uiState: StateFlow<HomeState> = combine(
    itemRepository.observeItems(),
    settingsRepository.observeTheme(),
    userRepository.observeProfile()
) { items, theme, profile ->
    HomeState(items = items, theme = theme, profile = profile)
}.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeState())
```

### Flow オペレーター

```kotlin
// 検索入力のデバウンス
searchQuery
    .debounce(300)
    .distinctUntilChanged()
    .flatMapLatest { query -> repository.search(query) }
    .catch { emit(emptyList()) }
    .collect { results -> _state.update { it.copy(results = results) } }

// 指数バックオフでリトライ
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

### ワンタイムイベント用の SharedFlow

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

// コンポーザブルでコレクト
LaunchedEffect(Unit) {
    viewModel.effects.collect { effect ->
        when (effect) {
            is Effect.ShowSnackbar -> snackbarHostState.showSnackbar(effect.message)
            is Effect.NavigateTo -> navController.navigate(effect.route)
        }
    }
}
```

## ディスパッチャー

```kotlin
// CPU 集約型作業
withContext(Dispatchers.Default) { parseJson(largePayload) }

// IO バウンド作業
withContext(Dispatchers.IO) { database.query() }

// メインスレッド（UI）— viewModelScope ではデフォルト
withContext(Dispatchers.Main) { updateUi() }
```

KMP では `Dispatchers.Default` と `Dispatchers.Main`（すべてのプラットフォームで利用可能）を使用してください。`Dispatchers.IO` は JVM/Android のみです — 他のプラットフォームでは `Dispatchers.Default` を使用するか DI で提供してください。

## キャンセル

### 協調的キャンセル

長時間実行されるループはキャンセルを確認する必要があります:

```kotlin
suspend fun processItems(items: List<Item>) = coroutineScope {
    for (item in items) {
        ensureActive()  // キャンセルされた場合は CancellationException をスロー
        process(item)
    }
}
```

### try/finally でのクリーンアップ

```kotlin
viewModelScope.launch {
    try {
        _state.update { it.copy(isLoading = true) }
        val data = repository.fetch()
        _state.update { it.copy(data = data) }
    } finally {
        _state.update { it.copy(isLoading = false) }  // キャンセル時でも常に実行
    }
}
```

## テスト

### Turbine を使った StateFlow のテスト

```kotlin
@Test
fun `search updates item list`() = runTest {
    val fakeRepository = FakeItemRepository().apply { emit(testItems) }
    val viewModel = ItemListViewModel(GetItemsUseCase(fakeRepository))

    viewModel.state.test {
        assertEquals(ItemListState(), awaitItem())  // 初期値

        viewModel.onSearch("query")
        val loading = awaitItem()
        assertTrue(loading.isLoading)

        val loaded = awaitItem()
        assertFalse(loaded.isLoading)
        assertEquals(1, loaded.items.size)
    }
}
```

### TestDispatcher でのテスト

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

### Flow のフェイク

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

## 避けるべきアンチパターン

- `GlobalScope` の使用 — コルーチンがリークし、構造化キャンセルがない
- スコープなしで `init {}` 内で Flow をコレクトする — `viewModelScope.launch` を使用
- ミュータブルコレクションで `MutableStateFlow` を使用する — 常にイミュータブルコピーを使用: `_state.update { it.copy(list = it.list + newItem) }`
- `CancellationException` をキャッチする — 適切なキャンセルのために伝播させる
- コレクトするために `flowOn(Dispatchers.Main)` を使用する — コレクションディスパッチャーは呼び出し元のディスパッチャー
- `remember` なしで `@Composable` 内に `Flow` を作成する — 再コンポジションのたびにフローが再作成される

## 参考

スキル: `compose-multiplatform-patterns` で Flow の UI 消費を参照。
スキル: `android-clean-architecture` でレイヤーにおけるコルーチンの役割を参照。
