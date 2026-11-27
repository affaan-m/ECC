---
name: android-clean-architecture
description: 适用于Android和Kotlin多平台项目的Clean Architecture模式——模块结构、依赖规则、用例、仓库以及数据层模式。
origin: ECC
---

# Android 整洁架构

适用于 Android 和 KMP 项目的整洁架构模式。涵盖模块边界、依赖反转、UseCase/Repository 模式，以及使用 Room、SQLDelight 和 Ktor 的数据层设计。

## 何时启用

* 构建 Android 或 KMP 项目模块结构
* 实现 UseCases、Repositories 或 DataSources
* 设计各层（领域层、数据层、表示层）之间的数据流
* 使用 Koin 或 Hilt 设置依赖注入
* 在分层架构中使用 Room、SQLDelight 或 Ktor

## 模块结构

### 推荐布局

```
project/
├── app/                  # Android 入口点，DI 装配，Application 类
├── core/                 # 共享工具类，基类，错误类型
├── domain/               # 用例，领域模型，仓库接口（纯 Kotlin）
├── data/                 # 仓库实现，数据源，数据库，网络
├── presentation/         # 界面，ViewModel，UI 模型，导航
├── design-system/        # 可复用的 Compose 组件，主题，排版
└── feature/              # 功能模块（可选，用于大型项目）
    ├── auth/
    ├── settings/
    └── profile/
```

### 依赖规则

```
app → presentation, domain, data, core
presentation → domain, design-system, core
data → domain, core
domain → core (或无依赖)
core → (无依赖)
```

**关键**：`domain` 绝不能依赖 `data`、`presentation` 或任何框架。它仅包含纯 Kotlin 代码。

## 领域层

### UseCase 模式

每个 UseCase 代表一个业务操作。使用 `operator fun invoke` 以获得简洁的调用点：

```kotlin
class GetItemsByCategoryUseCase(
    private val repository: ItemRepository
) {
    suspend operator fun invoke(category: String): Result<List<Item>> {
        return repository.getItemsByCategory(category)
    }
}

// Flow-based UseCase for reactive streams
class ObserveUserProgressUseCase(
    private val repository: UserRepository
) {
    operator fun invoke(userId: String): Flow<UserProgress> {
        return repository.observeProgress(userId)
    }
}
```

### 领域模型

领域模型是普通的 Kotlin 数据类——没有框架注解：

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

### 仓库接口

在领域层定义，在数据层实现：

```kotlin
interface ItemRepository {
    suspend fun getItemsByCategory(category: String): Result<List<Item>>
    suspend fun saveItem(item: Item): Result<Unit>
    fun observeItems(): Flow<List<Item>>
}
```

## 数据层

### 仓库实现

协调本地和远程数据源：

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

### 映射器模式

将映射器作为扩展函数放在数据模型附近：

```kotlin
// In data layer
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

### Room 数据库 (Android)

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

### SQLDelight (KMP)

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

### Ktor 网络客户端 (KMP)

```kotlin
class ItemRemoteDataSource(private val client: HttpClient) {

    suspend fun fetchItems(category: String): List<ItemDto> {
        return client.get("api/items") {
            parameter("category", category)
        }.body()
    }
}

// HttpClient setup with content negotiation
val httpClient = HttpClient {
    install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
    install(Logging) { level = LogLevel.HEADERS }
    defaultRequest { url("https://api.example.com/") }
}
```

## 依赖注入

### Koin (适用于 KMP)

```kotlin
// Domain module
val domainModule = module {
    factory { GetItemsByCategoryUseCase(get()) }
    factory { ObserveUserProgressUseCase(get()) }
}

// Data module
val dataModule = module {
    single<ItemRepository> { ItemRepositoryImpl(get(), get()) }
    single { ItemLocalDataSource(get()) }
    single { ItemRemoteDataSource(get()) }
}

// Presentation module
val presentationModule = module {
    viewModelOf(::ItemListViewModel)
    viewModelOf(::DashboardViewModel)
}
```

### Hilt (仅限 Android)

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

## 错误处理

### Result/Try 模式

使用 `Result<T>` 或自定义密封类型进行错误传播：

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

// In ViewModel — map to UI state
viewModelScope.launch {
    when (val result = getItems(category)) {
        is Try.Success -> _state.update { it.copy(items = result.value, isLoading = false) }
        is Try.Failure -> _state.update { it.copy(error = result.error.toMessage(), isLoading = false) }
    }
}
```

## 约定插件 (Gradle)

对于 KMP 项目，使用约定插件以减少构建文件重复：

```kotlin
// build-logic/src/main/kotlin/kmp-library.gradle.kts
plugins {
    id("org.jetbrains.kotlin.multiplatform")
}

kotlin {
    androidTarget()
    iosX64(); iosArm64(); iosSimulatorArm64()
    sourceSets {
        commonMain.dependencies { /* shared deps */ }
        commonTest.dependencies { implementation(kotlin("test")) }
    }
}
```

在模块中应用：

```kotlin
// domain/build.gradle.kts
plugins { id("kmp-library") }
```

## 应避免的反模式

* 在 `domain` 中导入 Android 框架类——保持其为纯 Kotlin
* 向 UI 层暴露数据库实体或 DTO——始终映射到领域模型
* 将业务逻辑放在 ViewModels 中——提取到 UseCases
* 使用 `GlobalScope` 或非结构化协程——使用 `viewModelScope` 或结构化并发
* 臃肿的仓库实现——拆分为专注的 DataSources
* 循环模块依赖——如果 A 依赖 B，则 B 绝不能依赖 A

## 参考

查看技能：`compose-multiplatform-patterns` 了解 UI 模式。
查看技能：`kotlin-coroutines-flows` 了解异步模式。
