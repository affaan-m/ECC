---
inclusion: fileMatch
fileMatchPattern: "*.kt"
description: Kotlin-specific patterns, coroutines, Compose, and Android/KMP best practices.
---

# Kotlin Patterns

> This file extends the common patterns with Kotlin and Android/KMP specific content.

## Immutability & Null Safety

- Prefer `val` over `var` — default to `val` and only use `var` when mutation is required
- Use `data class` for value types; use immutable collections in public APIs
- Never use `!!` — prefer `?.`, `?:`, `requireNotNull()`, or `checkNotNull()`

```kotlin
// BAD
val name = user!!.name

// GOOD
val name = user?.name ?: "Unknown"
```

## Sealed Types

Use sealed classes/interfaces to model closed state hierarchies:

```kotlin
sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Success<T>(val data: T) : UiState<T>
    data class Error(val message: String) : UiState<Nothing>
}
```

Always use exhaustive `when` with sealed types — no `else` branch.

## ViewModel Pattern

Single state object, event sink, one-way data flow:

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

## UseCase Pattern

Single responsibility, `operator fun invoke`:

```kotlin
class GetItemUseCase(private val repository: ItemRepository) {
    suspend operator fun invoke(id: String): Result<Item> {
        return repository.getById(id)
    }
}
```

## Dependency Injection

Prefer constructor injection. Use Koin (KMP) or Hilt (Android-only):

```kotlin
// Koin
val dataModule = module {
    single<ItemRepository> { ItemRepositoryImpl(get(), get()) }
    factory { GetItemsUseCase(get()) }
    viewModelOf(::ItemListViewModel)
}
```

## Coroutine Patterns

- Use `viewModelScope` in ViewModels, `coroutineScope` for structured child work
- Use `supervisorScope` when child failures should be independent
- Never catch `CancellationException` — always rethrow it

## expect/actual (KMP)

Use for platform-specific implementations:

```kotlin
// commonMain
expect fun platformName(): String

// androidMain
actual fun platformName(): String = "Android"

// iosMain
actual fun platformName(): String = "iOS"
```

## Security

- Never embed secrets in `BuildConfig` or resources — values are extractable from the APK
- Use `EncryptedSharedPreferences` or Android Keystore (Android), Keychain (iOS), or a server-side proxy for runtime secrets
- Use parameterized queries for Room/SQLDelight
- Configure `network_security_config.xml` to block cleartext traffic

## Testing

- Use `kotlin.test` for multiplatform, JUnit for Android-specific tests
- Use Turbine for testing Flows and StateFlow
- Use `runTest` with `kotlinx-coroutines-test` for coroutine testing
- Prefer hand-written fakes over mocking frameworks

```kotlin
@Test
fun `loading state emitted then data`() = runTest {
    val repo = FakeItemRepository()
    val viewModel = ItemListViewModel(GetItemsUseCase(repo))

    viewModel.state.test {
        assertEquals(ItemListState(), awaitItem())
        viewModel.onEvent(ItemListEvent.Load)
        assertTrue(awaitItem().isLoading)
    }
}
```

## Reference

See agents: `kotlin-reviewer`, `kotlin-build-resolver` for Kotlin-specific review and build error resolution.
