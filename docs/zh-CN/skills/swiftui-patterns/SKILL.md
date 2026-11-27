---
name: swiftui-patterns
description: SwiftUI 架构模式，使用 @Observable 进行状态管理，视图组合，导航，性能优化，以及现代 iOS/macOS UI 最佳实践。
---

# SwiftUI 模式

适用于 Apple 平台的现代 SwiftUI 模式，用于构建声明式、高性能的用户界面。涵盖 Observation 框架、视图组合、类型安全导航和性能优化。

## 何时激活

* 构建 SwiftUI 视图和管理状态时（`@State`、`@Observable`、`@Binding`）
* 使用 `NavigationStack` 设计导航流程时
* 构建视图模型和数据流时
* 优化列表和复杂布局的渲染性能时
* 在 SwiftUI 中使用环境值和依赖注入时

## 状态管理

### 属性包装器选择

选择最适合的最简单包装器：

| 包装器 | 使用场景 |
|---------|----------|
| `@State` | 视图本地的值类型（开关、表单字段、Sheet 展示） |
| `@Binding` | 指向父视图 `@State` 的双向引用 |
| `@Observable` 类 + `@State` | 拥有多个属性的自有模型 |
| `@Observable` 类（无包装器） | 从父视图传递的只读引用 |
| `@Bindable` | 指向 `@Observable` 属性的双向绑定 |
| `@Environment` | 通过 `.environment()` 注入的共享依赖项 |

### @Observable ViewModel

使用 `@Observable`（而非 `ObservableObject`）—— 它跟踪属性级别的变更，因此 SwiftUI 只会重新渲染读取了已变更属性的视图：

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

### 消费 ViewModel 的视图

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

### 环境注入

用 `@Environment` 替换 `@EnvironmentObject`：

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

## 视图组合

### 提取子视图以限制失效

将视图拆分为小型、专注的结构体。当状态变更时，只有读取该状态的子视图会重新渲染：

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

### 用于可复用样式的 ViewModifier

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

## 导航

### 类型安全的 NavigationStack

使用 `NavigationStack` 与 `NavigationPath` 来实现程序化、类型安全的路由：

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

## 性能

### 为大型集合使用惰性容器

`LazyVStack` 和 `LazyHStack` 仅在视图可见时才创建它们：

```swift
ScrollView {
    LazyVStack(spacing: 8) {
        ForEach(items) { item in
            ItemRow(item: item)
        }
    }
}
```

### 稳定的标识符

在 `ForEach` 中始终使用稳定、唯一的 ID —— 避免使用数组索引：

```swift
// Use Identifiable conformance or explicit id
ForEach(items, id: \.stableID) { item in
    ItemRow(item: item)
}
```

### 避免在 body 中进行昂贵操作

* 切勿在 `body` 内执行 I/O、网络调用或繁重计算
* 使用 `.task {}` 处理异步工作 —— 当视图消失时它会自动取消
* 在滚动视图中谨慎使用 `.sensoryFeedback()` 和 `.geometryGroup()`
* 在列表中最小化使用 `.shadow()`、`.blur()` 和 `.mask()` —— 它们会触发屏幕外渲染

### 遵循 Equatable

对于 body 计算昂贵的视图，遵循 `Equatable` 以跳过不必要的重新渲染：

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

## 预览

使用 `#Preview` 宏配合内联模拟数据以进行快速迭代：

```swift
#Preview("Empty state") {
    ItemListView(viewModel: ItemListViewModel(repository: EmptyMockRepository()))
}

#Preview("Loaded") {
    ItemListView(viewModel: ItemListViewModel(repository: PopulatedMockRepository()))
}
```

## 应避免的反模式

* 在新代码中使用 `ObservableObject` / `@Published` / `@StateObject` / `@EnvironmentObject` —— 迁移到 `@Observable`
* 将异步工作直接放在 `body` 或 `init` 中 —— 使用 `.task {}` 或显式的加载方法
* 在不拥有数据的子视图中将视图模型创建为 `@State` —— 改为从父视图传递
* 使用 `AnyView` 类型擦除 —— 对于条件视图，优先选择 `@ViewBuilder` 或 `Group`
* 在向 Actor 传递数据或从 Actor 接收数据时忽略 `Sendable` 要求

## 参考

查看技能：`swift-actor-persistence` 以了解基于 Actor 的持久化模式。
查看技能：`swift-protocol-di-testing` 以了解基于协议的 DI 和使用 Swift Testing 进行测试。
