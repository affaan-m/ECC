---
name: swift-actor-persistence
description: Swift 액터로 메모리 내 캐시와 파일 저장소를 결합하는 데이터 영속성 패턴입니다. Swift에서 데이터를 저장할 때 데이터 경쟁을 막고 스레드 안전성을 확보해야 한다면 이 스킬을 사용하세요.
origin: ECC
---

# Swift 액터로 스레드 안전한 데이터 저장 구현

Swift 액터를 활용해 스레드 안전성을 갖춘 데이터 영속성 계층을 구축하는 패턴입니다. 메모리 내 캐시와 파일 저장소를 결합하고, 컴파일러의 액터 격리 검사를 통해 데이터 경쟁을 방지합니다.

## 활성화 시점

- Swift 5.5 이상에서 데이터 영속성 계층을 구축할 때
- 변경 가능한 공유 상태를 여러 스레드에서 안전하게 읽고 써야 할 때
- 락이나 `DispatchQueue`를 사용한 수동 동기화를 없애고 싶을 때
- 로컬 저장소를 활용해 오프라인 우선 앱을 구축할 때

## 핵심 패턴

### 액터 기반 저장소

액터는 격리된 상태에 대한 접근을 직렬화합니다. 컴파일러가 격리 규칙을 검사해 데이터 경쟁을 방지합니다.

```swift
public actor LocalRepository<T: Codable & Identifiable> where T.ID == String {
    private var cache: [String: T] = [:]
    private let fileURL: URL

    public init(directory: URL = .documentsDirectory, filename: String = "data.json") {
        self.fileURL = directory.appendingPathComponent(filename)
        // 초기화 중에는 아직 액터 격리가 적용되지 않으므로 동기적으로 불러옵니다.
        self.cache = Self.loadSynchronously(from: fileURL)
    }

    // MARK: - 공개 API

    public func save(_ item: T) throws {
        cache[item.id] = item
        try persistToFile()
    }

    public func delete(_ id: String) throws {
        cache[id] = nil
        try persistToFile()
    }

    public func find(by id: String) -> T? {
        cache[id]
    }

    public func loadAll() -> [T] {
        Array(cache.values)
    }

    // MARK: - 비공개 메서드

    private func persistToFile() throws {
        let data = try JSONEncoder().encode(Array(cache.values))
        try data.write(to: fileURL, options: .atomic)
    }

    private static func loadSynchronously(from url: URL) -> [String: T] {
        guard let data = try? Data(contentsOf: url),
              let items = try? JSONDecoder().decode([T].self, from: data) else {
            return [:]
        }
        return Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
    }
}
```

### 사용 방법

액터 격리 규칙에 따라 아래 메서드를 액터 외부에서 호출할 때는 `await`가 필요합니다.

```swift
let repository = LocalRepository<Question>()

// 읽기: 메모리 캐시에서 식별자로 조회하는 데 O(1)이 걸립니다.
let question = await repository.find(by: "q-001")
let allQuestions = await repository.loadAll()

// 쓰기: 캐시를 갱신한 뒤 파일에 원자적으로 기록합니다.
try await repository.save(newQuestion)
try await repository.delete("q-001")
```

### `@Observable` 뷰 모델과 함께 사용

```swift
@Observable
final class QuestionListViewModel {
    private(set) var questions: [Question] = []
    private let repository: LocalRepository<Question>

    init(repository: LocalRepository<Question> = LocalRepository()) {
        self.repository = repository
    }

    func load() async {
        questions = await repository.loadAll()
    }

    func add(_ question: Question) async throws {
        try await repository.save(question)
        questions = await repository.loadAll()
    }
}
```

## 주요 설계 결정

| 설계 결정 | 근거 |
|----------|-----------|
| 클래스와 락으로 구현한 동기화를 액터로 대체 | 컴파일러가 스레드 안전성을 검사하므로 수동 동기화가 필요하지 않습니다. |
| 메모리 내 캐시와 파일 저장 | 읽기는 캐시에서 빠르게 처리하고, 쓰기는 디스크에 기록해 보존합니다. |
| `init`에서 동기적으로 불러오기 | 비동기 초기화의 복잡성을 피할 수 있습니다. |
| 식별자(ID)를 키로 사용하는 딕셔너리 | 식별자로 `O(1)` 시간에 조회할 수 있습니다. |
| `Codable & Identifiable`을 제약으로 두는 제네릭 | 제약을 충족하는 여러 모델 타입에서 재사용할 수 있습니다. |
| 원자적 파일 쓰기(`.atomic`) | 앱이 비정상 종료돼도 파일이 일부만 기록되는 일을 방지합니다. |

## 모범 사례

- **`Sendable` 타입 사용** — 액터 경계를 넘는 모든 데이터에 적용하세요.
- **공개 API(애플리케이션 프로그래밍 인터페이스)는 최소화** — 도메인 작업만 공개하고 저장 구현 세부 사항은 액터 내부에 두세요.
- **`.atomic`으로 파일 쓰기** — 쓰기 도중 앱이 비정상 종료될 때 데이터가 손상되는 것을 방지하세요.
- **`init`에서 동기적으로 불러오기** — 로컬 파일은 비동기 초기화로 얻는 이점이 적고 구현이 복잡해집니다.
- **`@Observable` 뷰 모델과 함께 사용** — 데이터가 바뀌면 사용자 인터페이스(UI)가 그에 맞춰 갱신되도록 하세요.

## 피해야 할 안티패턴

- 새 Swift 동시성 코드에서 액터를 쓸 자리에 `DispatchQueue`나 `NSLock` 사용
- 내부 캐시 딕셔너리를 외부 호출자에게 노출
- 검증 절차 없이 파일 주소(URL)를 설정할 수 있게 허용
- 액터 메서드를 외부에서 호출할 때 `await`를 빠뜨리거나 비동기 컨텍스트를 고려하지 않음
- `nonisolated`로 액터 격리를 우회해 격리의 목적을 무력화

## 활용 사례

- iOS 및 macOS 앱에서 사용자 데이터, 설정, 캐시된 콘텐츠를 로컬에 저장하는 경우
- 로컬에 먼저 저장한 뒤 나중에 서버와 동기화하는 오프라인 우선 아키텍처
- 앱의 여러 부분에서 변경 가능한 공유 상태에 동시에 접근하는 경우
- 스레드 안전성을 확보하던 기존 `DispatchQueue` 기반 코드를 최신 Swift 동시성 기능으로 교체하는 경우
