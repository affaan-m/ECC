---
paths:
  - "**/*.kt"
  - "**/*.kts"
---
# Kotlin パターン

> このファイルは [common/patterns.md](../common/patterns.md) を Kotlin および Android/KMP 固有のコンテンツで拡張します。

## 依存性注入

コンストラクタインジェクションを優先する。Koin（KMP）または Hilt（Android のみ）を使用:

```kotlin
// Koin — モジュール宣言
val dataModule = module {
    single<ItemRepository> { ItemRepositoryImpl(get(), get()) }
    factory { GetItemsUseCase(get()) }
    viewModelOf(::ItemListViewModel)
}

// Hilt — アノテーション
@HiltViewModel
class ItemListViewModel @Inject constructor(
    private val getItems: GetItemsUseCase
) : ViewModel()
```

## ViewModel パターン

単一の状態オブジェクト、イベントシンク、単方向データフロー:

```kotlin
data class ScreenState(
    val items: List<Item> = emptyList(),
    val isLoading: Boolean = false
)

class ScreenViewModel(private val useCase: GetItemsUseCase) : ViewModel() {
    private val _state = MutableStateFlow(ScreenState())
    val state = _state.asStateFlow()

    fun onEvent(event: ScreenEvent) {
        when (event) {
            is ScreenEvent.Load -> load()
            is ScreenEvent.Delete -> delete(event.id)
        }
    }
}
```

## リポジトリパターン

- `suspend` 関数は `Result<T>` またはカスタムエラー型を返す
- リアクティブストリームには `Flow`
- ローカルとリモートのデータソースを調整する

```kotlin
interface ItemRepository {
    suspend fun getById(id: String): Result<Item>
    suspend fun getAll(): Result<List<Item>>
    fun observeAll(): Flow<List<Item>>
}
```

## UseCase パターン

単一責任、`operator fun invoke`:

```kotlin
class GetItemUseCase(private val repository: ItemRepository) {
    suspend operator fun invoke(id: String): Result<Item> {
        return repository.getById(id)
    }
}

class GetItemsUseCase(private val repository: ItemRepository) {
    suspend operator fun invoke(): Result<List<Item>> {
        return repository.getAll()
    }
}
```

## expect/actual（KMP）

プラットフォーム固有の実装に使用:

```kotlin
// commonMain
expect fun platformName(): String
expect class SecureStorage {
    fun save(key: String, value: String)
    fun get(key: String): String?
}

// androidMain
actual fun platformName(): String = "Android"
actual class SecureStorage {
    actual fun save(key: String, value: String) { /* EncryptedSharedPreferences */ }
    actual fun get(key: String): String? = null /* ... */
}

// iosMain
actual fun platformName(): String = "iOS"
actual class SecureStorage {
    actual fun save(key: String, value: String) { /* Keychain */ }
    actual fun get(key: String): String? = null /* ... */
}
```

## コルーチンパターン

- ViewModel では `viewModelScope`、構造化された子作業には `coroutineScope` を使用
- コールド Flow から StateFlow への変換には `stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), initialValue)` を使用
- 子の失敗を独立させる場合は `supervisorScope` を使用

## DSL を使った Builder パターン

```kotlin
class HttpClientConfig {
    var baseUrl: String = ""
    var timeout: Long = 30_000
    private val interceptors = mutableListOf<Interceptor>()

    fun interceptor(block: () -> Interceptor) {
        interceptors.add(block())
    }
}

fun httpClient(block: HttpClientConfig.() -> Unit): HttpClient {
    val config = HttpClientConfig().apply(block)
    return HttpClient(config)
}

// 使用例
val client = httpClient {
    baseUrl = "https://api.example.com"
    timeout = 15_000
    interceptor { AuthInterceptor(tokenProvider) }
}
```

## リファレンス

スキル: `kotlin-coroutines-flows` で詳細なコルーチンパターンを参照してください。
スキル: `android-clean-architecture` でモジュールとレイヤーパターンを参照してください。
