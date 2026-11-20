---
name: swiftui-patterns
description: SwiftUI 아키텍처 패턴과 @Observable을 활용한 상태 관리, 뷰 합성, 내비게이션, 성능 최적화, 최신 iOS 및 macOS 사용자 인터페이스(UI) 모범 사례를 다룹니다. SwiftUI 뷰를 작성하거나 리뷰할 때, 또는 @Observable 상태, 내비게이션, 렌더링 성능을 다룰 때 사용합니다.
origin: ECC
---

# SwiftUI 패턴

Apple 플랫폼에서 선언적 방식으로 고성능 사용자 인터페이스를 만드는 최신 SwiftUI 패턴을 소개합니다. Observation 프레임워크, 뷰 합성, 타입 안전성을 갖춘 내비게이션, 성능 최적화를 다룹니다.

## 활성화 시점

- SwiftUI 뷰를 만들고 `@State`, `@Observable`, `@Binding`으로 상태를 관리할 때
- `NavigationStack`으로 화면 이동 흐름을 설계할 때
- 뷰 모델과 데이터 흐름을 구성할 때
- 리스트와 복잡한 레이아웃의 렌더링 성능을 최적화할 때
- SwiftUI에서 환경 값과 의존성 주입을 사용할 때

## 상태 관리

### 프로퍼티 래퍼 선택

용도에 맞는 가장 단순한 래퍼를 선택하세요.

| 래퍼 | 사용 사례 |
|---------|----------|
| `@State` | 뷰 내부에서 관리하는 값 타입(토글 상태, 폼 필드, 시트 표시 여부) |
| `@Binding` | 상위 뷰의 `@State`를 읽고 쓸 수 있는 양방향 참조 |
| `@Observable` 클래스 + `@State` | 뷰가 직접 소유하는 모델(프로퍼티가 여러 개인 경우) |
| `@Observable` 클래스(래퍼 없이 사용) | 상위 뷰에서 전달받아 읽기 전용으로 사용하는 참조 |
| `@Bindable` | `@Observable` 프로퍼티에 대한 양방향 바인딩 |
| `@Environment` | `.environment()`로 주입하는 공유 의존성 |

### `@Observable` 뷰 모델

뷰 모델을 `@Observable`로 구현하세요. 기존 `ObservableObject` 뷰 모델도 이 방식으로 전환할 수 있습니다. `@Observable`은 프로퍼티별 변경을 추적하므로 SwiftUI는 바뀐 프로퍼티를 읽은 뷰만 다시 렌더링합니다.

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

### 뷰 모델을 사용하는 뷰

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

### 환경 값으로 의존성 주입

`@EnvironmentObject`에서 `@Environment`로 전환하세요.

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

## 뷰 합성

### 하위 뷰로 나눠 다시 렌더링할 범위 줄이기

뷰를 한 가지 역할을 맡는 작은 구조체로 나누세요. 상태가 바뀌면 해당 상태를 읽는 하위 뷰만 다시 렌더링됩니다.

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

### `ViewModifier`로 스타일 재사용

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

## 내비게이션

### `NavigationStack`으로 화면 이동의 타입 안전성 확보

코드에서 화면 이동을 제어할 때는 `NavigationStack`과 `NavigationPath`를 조합해 타입 안전성을 확보하세요.

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

## 성능

### 항목이 많은 컬렉션에 지연 생성 컨테이너 사용

`LazyVStack`과 `LazyHStack`은 화면에 표시하는 데 필요한 하위 뷰를 그때그때 생성합니다.

```swift
ScrollView {
    LazyVStack(spacing: 8) {
        ForEach(items) { item in
            ItemRow(item: item)
        }
    }
}
```

### 안정적인 식별자

`ForEach`에는 항목마다 고유하고 변경되지 않는 식별자(ID)를 사용하세요. 배열 인덱스를 식별자로 사용하는 것은 피하세요.

```swift
// Use Identifiable conformance or explicit id
ForEach(items, id: \.stableID) { item in
    ItemRow(item: item)
}
```

### `body`에서 비용이 큰 작업 피하기

- `body`에서 입출력(I/O), 네트워크 호출, 비용이 큰 연산을 수행하지 마세요.
- 비동기 작업에는 `.task {}`를 사용하세요. 뷰가 사라지면 작업이 자동으로 취소됩니다.
- 스크롤 뷰에서 `.sensoryFeedback()`과 `.geometryGroup()`은 꼭 필요한 곳에만 사용하세요.
- 리스트에서 `.shadow()`, `.blur()`, `.mask()`는 오프스크린 렌더링을 유발하므로 사용을 최소화하세요.

### `Equatable` 프로토콜 채택

`body`를 계산하는 비용이 큰 뷰는 `Equatable` 프로토콜을 채택해 불필요한 재렌더링을 줄이세요.

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

## 미리보기

`#Preview` 매크로에 Mock 데이터를 직접 넣어 여러 상태에서 뷰를 빠르게 확인하세요.

```swift
#Preview("Empty state") {
    ItemListView(viewModel: ItemListViewModel(repository: EmptyMockRepository()))
}

#Preview("Loaded") {
    ItemListView(viewModel: ItemListViewModel(repository: PopulatedMockRepository()))
}
```

## 피해야 할 안티패턴

- 새 코드에 `ObservableObject`, `@Published`, `@StateObject`, `@EnvironmentObject`를 사용하는 패턴은 피하세요. `@Observable`로 마이그레이션하세요.
- `body`나 `init`에서 비동기 작업을 직접 수행하는 패턴은 피하세요. `.task {}`나 명시적인 로드 메서드를 사용하세요.
- 데이터를 소유하지 않는 하위 뷰에서 `@State`로 뷰 모델을 생성하는 패턴은 피하세요. 상위 뷰에서 뷰 모델을 전달하세요.
- `AnyView`를 사용한 타입 소거는 피하세요. 조건부 뷰에는 `@ViewBuilder`나 `Group`을 우선 사용하세요.
- 액터에 데이터를 전달하거나 액터에서 데이터를 받을 때 `Sendable` 요구 사항을 빠뜨리지 마세요.

## 참고 자료

액터 기반 영속성 패턴은 `swift-actor-persistence` 스킬을 참고하세요.
프로토콜 기반 의존성 주입(DI)과 Swift Testing을 활용한 테스트는 `swift-protocol-di-testing` 스킬을 참고하세요.
