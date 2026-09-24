---
name: compose-multiplatform-patterns
description: KMPプロジェクト向けのCompose MultiplatformおよびJetpack Composeパターン — 状態管理、ナビゲーション、テーマ設定、パフォーマンス、プラットフォーム固有のUI。
origin: ECC
---

# Compose Multiplatformパターン

Compose MultiplatformとJetpack Composeを使用して、Android、iOS、デスクトップ、Web間で共有UIを構築するためのパターン。状態管理、ナビゲーション、テーマ設定、パフォーマンスをカバーします。

## 起動条件

- Compose UIの構築（Jetpack ComposeまたはCompose Multiplatform）
- ViewModelとCompose状態によるUI状態の管理
- KMPまたはAndroidプロジェクトでのナビゲーション実装
- 再利用可能なコンポーザブルとデザインシステムの設計
- リコンポジションとレンダリングパフォーマンスの最適化

## 状態管理

### ViewModel + 単一状態オブジェクト

画面状態には単一のデータクラスを使用します。`StateFlow`として公開し、Composeで収集します：

```kotlin
data class ItemListState(
    val items: List<Item> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val searchQuery: String = ""
)

class ItemListViewModel(
    private val getItems: GetItemsUseCase
) : ViewModel() {
    private val _state = MutableStateFlow(ItemListState())
    val state: StateFlow<ItemListState> = _state.asStateFlow()

    fun onSearch(query: String) {
        _state.update { it.copy(searchQuery = query) }
        loadItems(query)
    }

    private fun loadItems(query: String) {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true) }
            getItems(query).fold(
                onSuccess = { items -> _state.update { it.copy(items = items, isLoading = false) } },
                onFailure = { e -> _state.update { it.copy(error = e.message, isLoading = false) } }
            )
        }
    }
}
```

### Composeでの状態収集

```kotlin
@Composable
fun ItemListScreen(viewModel: ItemListViewModel = koinViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    ItemListContent(
        state = state,
        onSearch = viewModel::onSearch
    )
}

@Composable
private fun ItemListContent(
    state: ItemListState,
    onSearch: (String) -> Unit
) {
    // ステートレスなコンポーザブル — プレビューとテストが容易
}
```

### イベントシンクパターン

複雑な画面では、複数のコールバックラムダの代わりにイベント用のシールドインターフェースを使用します：

```kotlin
sealed interface ItemListEvent {
    data class Search(val query: String) : ItemListEvent
    data class Delete(val itemId: String) : ItemListEvent
    data object Refresh : ItemListEvent
}

// ViewModelの中
fun onEvent(event: ItemListEvent) {
    when (event) {
        is ItemListEvent.Search -> onSearch(event.query)
        is ItemListEvent.Delete -> deleteItem(event.itemId)
        is ItemListEvent.Refresh -> loadItems(_state.value.searchQuery)
    }
}

// コンポーザブルの中 — 多数ではなく単一ラムダ
ItemListContent(
    state = state,
    onEvent = viewModel::onEvent
)
```

## ナビゲーション

### 型安全なナビゲーション（Compose Navigation 2.8+）

ルートを`@Serializable`オブジェクトとして定義します：

```kotlin
@Serializable data object HomeRoute
@Serializable data class DetailRoute(val id: String)
@Serializable data object SettingsRoute

@Composable
fun AppNavHost(navController: NavHostController = rememberNavController()) {
    NavHost(navController, startDestination = HomeRoute) {
        composable<HomeRoute> {
            HomeScreen(onNavigateToDetail = { id -> navController.navigate(DetailRoute(id)) })
        }
        composable<DetailRoute> { backStackEntry ->
            val route = backStackEntry.toRoute<DetailRoute>()
            DetailScreen(id = route.id)
        }
        composable<SettingsRoute> { SettingsScreen() }
    }
}
```

### ダイアログとボトムシートナビゲーション

命令型のshow/hideの代わりに`dialog()`とオーバーレイパターンを使用します：

```kotlin
NavHost(navController, startDestination = HomeRoute) {
    composable<HomeRoute> { /* ... */ }
    dialog<ConfirmDeleteRoute> { backStackEntry ->
        val route = backStackEntry.toRoute<ConfirmDeleteRoute>()
        ConfirmDeleteDialog(
            itemId = route.itemId,
            onConfirm = { navController.popBackStack() },
            onDismiss = { navController.popBackStack() }
        )
    }
}
```

## コンポーザブル設計

### スロットベースのAPI

柔軟性のためにスロットパラメータを持つコンポーザブルを設計します：

```kotlin
@Composable
fun AppCard(
    modifier: Modifier = Modifier,
    header: @Composable () -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
    actions: @Composable RowScope.() -> Unit = {}
) {
    Card(modifier = modifier) {
        Column {
            header()
            Column(content = content)
            Row(horizontalArrangement = Arrangement.End, content = actions)
        }
    }
}
```

### Modifier順序

Modifierの順序は重要です — 以下の順序で適用します：

```kotlin
Text(
    text = "Hello",
    modifier = Modifier
        .padding(16.dp)          // 1. レイアウト（パディング、サイズ）
        .clip(RoundedCornerShape(8.dp))  // 2. 形状
        .background(Color.White) // 3. 描画（背景、ボーダー）
        .clickable { }           // 4. インタラクション
)
```

## KMPプラットフォーム固有のUI

### プラットフォームコンポーザブルのexpect/actual

```kotlin
// commonMain
@Composable
expect fun PlatformStatusBar(darkIcons: Boolean)

// androidMain
@Composable
actual fun PlatformStatusBar(darkIcons: Boolean) {
    val systemUiController = rememberSystemUiController()
    SideEffect { systemUiController.setStatusBarColor(Color.Transparent, darkIcons) }
}

// iosMain
@Composable
actual fun PlatformStatusBar(darkIcons: Boolean) {
    // iOSはUIKitインターロップまたはInfo.plistで処理
}
```

## パフォーマンス

### スキップ可能なリコンポジションのための安定した型

すべてのプロパティが安定している場合、クラスを`@Stable`または`@Immutable`でマークします：

```kotlin
@Immutable
data class ItemUiModel(
    val id: String,
    val title: String,
    val description: String,
    val progress: Float
)
```

### `key()`と遅延リストの正しい使用

```kotlin
LazyColumn {
    items(
        items = items,
        key = { it.id }  // 安定したキーによりアイテムの再利用とアニメーションが可能
    ) { item ->
        ItemRow(item = item)
    }
}
```

### `derivedStateOf`で読み取りを遅延

```kotlin
val listState = rememberLazyListState()
val showScrollToTop by remember {
    derivedStateOf { listState.firstVisibleItemIndex > 5 }
}
```

### リコンポジションでのアロケーションを避ける

```kotlin
// 悪い例 — リコンポジションのたびに新しいラムダとリストが作られる
items.filter { it.isActive }.forEach { ActiveItem(it, onClick = { handle(it) }) }

// 良い例 — 各アイテムにキーを付けてコールバックが正しい行に紐づくようにする
val activeItems = remember(items) { items.filter { it.isActive } }
activeItems.forEach { item ->
    key(item.id) {
        ActiveItem(item, onClick = { handle(item) })
    }
}
```

## テーマ設定

### Material 3ダイナミックテーマ

```kotlin
@Composable
fun AppTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            if (darkTheme) dynamicDarkColorScheme(LocalContext.current)
            else dynamicLightColorScheme(LocalContext.current)
        }
        darkTheme -> darkColorScheme()
        else -> lightColorScheme()
    }

    MaterialTheme(colorScheme = colorScheme, content = content)
}
```

## 避けるべきアンチパターン

- ライフサイクルに対してより安全な`collectAsStateWithLifecycle`を使用した`MutableStateFlow`がある場合にViewModelで`mutableStateOf`を使用すること
- コンポーザブルの深い階層に`NavController`を渡すこと — 代わりにラムダコールバックを渡す
- `@Composable`関数内の重い計算 — ViewModelか`remember {}`に移動する
- 一部の設定では設定変更のたびに再実行されるため、ViewModel initの代替として`LaunchedEffect(Unit)`を使用すること
- コンポーザブルのパラメータに新しいオブジェクトインスタンスを作成すること — 不必要なリコンポジションを引き起こす

## 参照

スキル: モジュール構造とレイヤーについては`android-clean-architecture`を参照。
スキル: コルーチンとFlowパターンについては`kotlin-coroutines-flows`を参照。
