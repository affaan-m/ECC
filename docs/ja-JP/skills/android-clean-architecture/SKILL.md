---
name: android-clean-architecture
description: Android と Kotlin Multiplatform プロジェクトのクリーンアーキテクチャパターン — モジュール構造、依存関係ルール、UseCase、Repository、データ層パターン。
origin: ECC
---

# Android クリーンアーキテクチャ

Android と KMP プロジェクトのクリーンアーキテクチャパターン。モジュール境界、依存関係の逆転、UseCase/Repository パターン、Room・SQLDelight・Ktor を使用したデータ層設計をカバーします。

## 起動タイミング

- Android または KMP プロジェクトモジュールの構造化
- UseCase、Repository、DataSource の実装
- 層間のデータフロー設計（ドメイン、データ、プレゼンテーション）
- Koin または Hilt による依存性注入のセットアップ
- 層状アーキテクチャでの Room、SQLDelight、Ktor の使用

## モジュール構造

### 推奨レイアウト

```
project/
├── app/                  # Android エントリポイント、DI ワイヤリング、Application クラス
├── core/                 # 共有ユーティリティ、基底クラス、エラー型
├── domain/               # UseCase、ドメインモデル、リポジトリインターフェース（純粋 Kotlin）
├── data/                 # リポジトリ実装、DataSource、DB、ネットワーク
├── presentation/         # スクリーン、ViewModel、UI モデル、ナビゲーション
├── design-system/        # 再利用可能な Compose コンポーネント、テーマ、タイポグラフィ
└── feature/              # フィーチャーモジュール（大規模プロジェクト向けのオプション）
    ├── auth/
    ├── settings/
    └── profile/
```

### 依存関係ルール

```
app → presentation, domain, data, core
presentation → domain, design-system, core
data → domain, core
domain → core（または依存関係なし）
core → （なし）
```

**重要**: `domain` は `data`、`presentation`、またはどのフレームワークにも依存してはいけません。純粋な Kotlin のみを含みます。

## ドメイン層

### UseCase パターン

各 UseCase は 1 つのビジネス操作を表します。クリーンな呼び出しサイトのために `operator fun invoke` を使用します：

```kotlin
class GetItemsByCategoryUseCase(
    private val repository: ItemRepository
) {
    suspend operator fun invoke(category: String): Result<List<Item>> {
        return repository.getItemsByCategory(category)
    }
}

// リアクティブストリーム向けフローベースの UseCase
class ObserveUserProgressUseCase(
    private val repository: UserRepository
) {
    operator fun invoke(userId: String): Flow<UserProgress> {
        return repository.observeProgress(userId)
    }
}
```

### ドメインモデル

ドメインモデルはプレーンな Kotlin データクラス — フレームワークのアノテーションなし：

```kotlin
data class Item(
    val id: String,
    val title: String,
    val description: String,
    val tags: List<String>,
    val status: Status,
    val category: String
)

enum class Status { DRAFT, ACTIVE, ARCHIVED }
```

### リポジトリインターフェース

ドメインで定義し、データで実装する：

```kotlin
interface ItemRepository {
    suspend fun getItemsByCategory(category: String): Result<List<Item>>
    suspend fun saveItem(item: Item): Result<Unit>
    fun observeItems(): Flow<List<Item>>
}
```

## データ層

### リポジトリ実装

ローカルとリモートのデータソース間を調整する：

```kotlin
class ItemRepositoryImpl(
    private val localDataSource: ItemLocalDataSource,
    private val remoteDataSource: ItemRemoteDataSource
) : ItemRepository {

    override suspend fun getItemsByCategory(category: String): Result<List<Item>> {
        return runCatching {
            val remote = remoteDataSource.fetchItems(category)
            localDataSource.insertItems(remote.map { it.toEntity() })
            localDataSource.getItemsByCategory(category).map { it.toDomain() }
        }
    }

    override suspend fun saveItem(item: Item): Result<Unit> {
        return runCatching {
            localDataSource.insertItems(listOf(item.toEntity()))
        }
    }

    override fun observeItems(): Flow<List<Item>> {
        return localDataSource.observeAll().map { entities ->
            entities.map { it.toDomain() }
        }
    }
}
```

### マッパーパターン

マッパーはデータモデルの近くに拡張関数として保持する：

```kotlin
// データ層
fun ItemEntity.toDomain() = Item(
    id = id,
    title = title,
    description = description,
    tags = tags.split("|"),
    status = Status.valueOf(status),
    category = category
)

fun ItemDto.toEntity() = ItemEntity(
    id = id,
    title = title,
    description = description,
    tags = tags.joinToString("|"),
    status = status,
    category = category
)
```

### Room データベース（Android）

```kotlin
@Entity(tableName = "items")
data class ItemEntity(
    @PrimaryKey val id: String,
    val title: String,
    val description: String,
    val tags: String,
    val status: String,
    val category: String
)

@Dao
interface ItemDao {
    @Query("SELECT * FROM items WHERE category = :category")
    suspend fun getByCategory(category: String): List<ItemEntity>

    @Upsert
    suspend fun upsert(items: List<ItemEntity>)

    @Query("SELECT * FROM items")
    fun observeAll(): Flow<List<ItemEntity>>
}
```

### SQLDelight（KMP）

```sql
-- Item.sq
CREATE TABLE ItemEntity (
    id TEXT NOT NULL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    tags TEXT NOT NULL,
    status TEXT NOT NULL,
    category TEXT NOT NULL
);

getByCategory:
SELECT * FROM ItemEntity WHERE category = ?;

upsert:
INSERT OR REPLACE INTO ItemEntity (id, title, description, tags, status, category)
VALUES (?, ?, ?, ?, ?, ?);

observeAll:
SELECT * FROM ItemEntity;
```

### Ktor ネットワーククライアント（KMP）

```kotlin
class ItemRemoteDataSource(private val client: HttpClient) {

    suspend fun fetchItems(category: String): List<ItemDto> {
        return client.get("api/items") {
            parameter("category", category)
        }.body()
    }
}

// コンテントネゴシエーション付き HttpClient セットアップ
val httpClient = HttpClient {
    install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
    install(Logging) { level = LogLevel.HEADERS }
    defaultRequest { url("https://api.example.com/") }
}
```

## 依存性注入

### Koin（KMP フレンドリー）

```kotlin
// ドメインモジュール
val domainModule = module {
    factory { GetItemsByCategoryUseCase(get()) }
    factory { ObserveUserProgressUseCase(get()) }
}

// データモジュール
val dataModule = module {
    single<ItemRepository> { ItemRepositoryImpl(get(), get()) }
    single { ItemLocalDataSource(get()) }
    single { ItemRemoteDataSource(get()) }
}

// プレゼンテーションモジュール
val presentationModule = module {
    viewModelOf(::ItemListViewModel)
    viewModelOf(::DashboardViewModel)
}
```

### Hilt（Android のみ）

```kotlin
@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {
    @Binds
    abstract fun bindItemRepository(impl: ItemRepositoryImpl): ItemRepository
}

@HiltViewModel
class ItemListViewModel @Inject constructor(
    private val getItems: GetItemsByCategoryUseCase
) : ViewModel()
```

## エラー処理

### Result/Try パターン

エラー伝播に `Result<T>` またはカスタムシール型を使用する：

```kotlin
sealed interface Try<out T> {
    data class Success<T>(val value: T) : Try<T>
    data class Failure(val error: AppError) : Try<Nothing>
}

sealed interface AppError {
    data class Network(val message: String) : AppError
    data class Database(val message: String) : AppError
    data object Unauthorized : AppError
}

// ViewModel — UI 状態にマッピング
viewModelScope.launch {
    when (val result = getItems(category)) {
        is Try.Success -> _state.update { it.copy(items = result.value, isLoading = false) }
        is Try.Failure -> _state.update { it.copy(error = result.error.toMessage(), isLoading = false) }
    }
}
```

## コンベンションプラグイン（Gradle）

KMP プロジェクトでは、ビルドファイルの重複を削減するためにコンベンションプラグインを使用する：

```kotlin
// build-logic/src/main/kotlin/kmp-library.gradle.kts
plugins {
    id("org.jetbrains.kotlin.multiplatform")
}

kotlin {
    androidTarget()
    iosX64(); iosArm64(); iosSimulatorArm64()
    sourceSets {
        commonMain.dependencies { /* 共有依存関係 */ }
        commonTest.dependencies { implementation(kotlin("test")) }
    }
}
```

モジュールに適用する：

```kotlin
// domain/build.gradle.kts
plugins { id("kmp-library") }
```

## 避けるべきアンチパターン

- `domain` に Android フレームワークのクラスをインポートする — 純粋な Kotlin に保つ
- データベースエンティティや DTO を UI 層に公開する — 常にドメインモデルにマッピングする
- ViewModel にビジネスロジックを配置する — UseCase に抽出する
- `GlobalScope` や非構造化コルーチンを使用する — `viewModelScope` または構造化された並行処理を使用する
- 肥大化したリポジトリ実装 — 焦点を絞った DataSource に分割する
- 循環モジュール依存 — A が B に依存する場合、B は A に依存してはいけない

## 参考資料

スキル参照: UI パターンは `compose-multiplatform-patterns` を参照。
非同期パターンは `kotlin-coroutines-flows` を参照。
