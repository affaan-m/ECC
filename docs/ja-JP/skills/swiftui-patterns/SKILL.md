---
name: swiftui-patterns
description: @Observableを使用した状態管理、ビュー合成、ナビゲーション、パフォーマンス最適化、モダンなiOS/macOS UIのベストプラクティスを備えたSwiftUIアーキテクチャパターン。
---

# SwiftUI パターン

Appleプラットフォーム向けのモダンなSwiftUIパターン。宣言的で高性能なユーザーインターフェースを構築するために使用する。Observationフレームワーク、ビュー合成、型安全なナビゲーション、パフォーマンス最適化をカバーする。

## 起動条件

* SwiftUIビューを構築し、状態を管理する場合（`@State`、`@Observable`、`@Binding`）
* `NavigationStack` を使用したナビゲーションフローを設計する場合
* ビューモデルとデータフローを構築する場合
* リストと複雑なレイアウトのレンダリングパフォーマンスを最適化する場合
* SwiftUIで環境値と依存性注入を使用する場合

## 状態管理

### プロパティラッパーの選択

最も適したシンプルなラッパーを選択する：

| ラッパー | 使用場面 |
|---------|----------|
| `@State` | ビューローカルな値型（トグル、フォームフィールド、シート表示） |
| `@Binding` | 親ビューの `@State` への双方向参照 |
| `@Observable` クラス + `@State` | 複数のプロパティを持つ所有モデル |
| `@Observable` クラス（ラッパーなし） | 親ビューから渡される読み取り専用参照 |
| `@Bindable` | `@Observable` プロパティへの双方向バインディング |
| `@Environment` | `.environment()` で注入された共有依存関係 |

### @Observable ViewModel

`ObservableObject` ではなく `@Observable` を使用する——プロパティレベルの変更を追跡するため、SwiftUIは変更されたプロパティを読み取ったビューのみを再レンダリングする：

```swift
@Observable
final class ItemListViewModel {
    private(set) var items: [Item] = []
    private(set) var isLoading = false
    var searchText = ""

    private let repository: any ItemRepository

    init(repository: any ItemRepository = DefaultItemRepository()) {
        self.repository = repository
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        items = (try? await repository.fetchAll()) ?? []
    }
}
```

### ViewModelを使用するビュー

```swift
struct ItemListView: View {
    @State private var viewModel: ItemListViewModel

    init(viewModel: ItemListViewModel = ItemListViewModel()) {
        _viewModel = State(initialValue: viewModel)
    }

    var body: some View {
        List(viewModel.items) { item in
            ItemRow(item: item)
        }
        .searchable(text: $viewModel.searchText)
        .overlay { if viewModel.isLoading { ProgressView() } }
        .task { await viewModel.load() }
    }
}
```

### 環境への注入

`@EnvironmentObject` の代わりに `@Environment` を使用する：

```swift
// Inject
ContentView()
    .environment(authManager)

// Consume
struct ProfileView: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        Text(auth.currentUser?.name ?? "Guest")
    }
}
```

## ビュー合成

### 無効化を制限するためにサブビューを抽出する

ビューを小さく焦点を絞った構造体に分割する。状態が変化した場合、その状態を読み取ったサブビューのみが再レンダリングされる：

```swift
struct OrderView: View {
    @State private var viewModel = OrderViewModel()

    var body: some View {
        VStack {
            OrderHeader(title: viewModel.title)
            OrderItemList(items: viewModel.items)
            OrderTotal(total: viewModel.total)
        }
    }
}
```

### 再利用可能なスタイルのための ViewModifier

```swift
struct CardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding()
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

extension View {
    func cardStyle() -> some View {
        modifier(CardModifier())
    }
}
```

## ナビゲーション

### 型安全な NavigationStack

`NavigationStack` と `NavigationPath` を使用して、プログラム的で型安全なルーティングを実現する：

```swift
@Observable
final class Router {
    var path = NavigationPath()

    func navigate(to destination: Destination) {
        path.append(destination)
    }

    func popToRoot() {
        path = NavigationPath()
    }
}

enum Destination: Hashable {
    case detail(Item.ID)
    case settings
    case profile(User.ID)
}

struct RootView: View {
    @State private var router = Router()

    var body: some View {
        NavigationStack(path: $router.path) {
            HomeView()
                .navigationDestination(for: Destination.self) { dest in
                    switch dest {
                    case .detail(let id): ItemDetailView(itemID: id)
                    case .settings: SettingsView()
                    case .profile(let id): ProfileView(userID: id)
                    }
                }
        }
        .environment(router)
    }
}
```

## パフォーマンス

### 大規模なコレクションにレイジーコンテナを使用する

`LazyVStack` と `LazyHStack` はビューが表示される時のみ作成する：

```swift
ScrollView {
    LazyVStack(spacing: 8) {
        ForEach(items) { item in
            ItemRow(item: item)
        }
    }
}
```

### 安定した識別子

`ForEach` では常に安定した一意のIDを使用する——配列インデックスは避ける：

```swift
// Use Identifiable conformance or explicit id
ForEach(items, id: \.stableID) { item in
    ItemRow(item: item)
}
```

### body 内での高コストな操作を避ける

* `body` 内でI/O、ネットワーク呼び出し、重い計算を絶対に実行しない
* 非同期処理には `.task {}` を使用する——ビューが消えると自動的にキャンセルされる
* スクロールビューでは `.sensoryFeedback()` と `.geometryGroup()` を慎重に使用する
* リストでは `.shadow()`、`.blur()`、`.mask()` の使用を最小化する——画面外レンダリングを引き起こす

### Equatable に準拠する

bodyの計算が高コストなビューには、不要な再レンダリングをスキップするために `Equatable` に準拠する：

```swift
struct ExpensiveChartView: View, Equatable {
    let dataPoints: [DataPoint] // DataPoint must conform to Equatable

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.dataPoints == rhs.dataPoints
    }

    var body: some View {
        // Complex chart rendering
    }
}
```

## プレビュー

インラインのモックデータで `#Preview` マクロを使用して素早い反復を行う：

```swift
#Preview("Empty state") {
    ItemListView(viewModel: ItemListViewModel(repository: EmptyMockRepository()))
}

#Preview("Loaded") {
    ItemListView(viewModel: ItemListViewModel(repository: PopulatedMockRepository()))
}
```

## 避けるべきアンチパターン

* 新しいコードで `ObservableObject` / `@Published` / `@StateObject` / `@EnvironmentObject` を使用する——`@Observable` に移行する
* `body` や `init` 内に直接非同期処理を置く——`.task {}` または明示的なロードメソッドを使用する
* データを所有しないサブビューでViewModelを `@State` として作成する——代わりに親ビューから渡す
* `AnyView` による型消去を使用する——条件付きビューには `@ViewBuilder` または `Group` を優先する
* ActorとのデータのやりとりにおいてSendable要件を無視する

## 参照

Actorベースの永続化パターンについては、スキル `swift-actor-persistence` を参照。
プロトコルベースのDIとSwift Testingを使用したテストについては、スキル `swift-protocol-di-testing` を参照。
