---
name: swift-protocol-di-testing
description: 테스트하기 쉬운 Swift 코드를 위한 프로토콜 기반 의존성 주입 패턴입니다. 역할이 분명한 프로토콜로 파일 시스템, 네트워크, 외부 API(애플리케이션 프로그래밍 인터페이스)를 Mock으로 대체하고 Swift Testing으로 검증합니다. Swift 코드를 테스트할 때 이런 외부 의존성을 제어해야 한다면 이 스킬을 사용하세요.
origin: ECC
---

# Swift 테스트를 위한 프로토콜 기반 의존성 주입

파일 시스템, 네트워크, iCloud 같은 외부 의존성을 작고 역할이 분명한 프로토콜로 추상화해 Swift 코드를 테스트하기 쉽게 만드는 패턴입니다. 입출력(I/O) 없이도 같은 입력에서 항상 같은 결과를 얻는 테스트를 작성할 수 있습니다.

## 활성화 시점

- 파일 시스템, 네트워크, 외부 API에 접근하는 Swift 코드를 작성할 때
- 실제 장애를 일으키지 않고 오류 처리 경로를 테스트해야 할 때
- 앱, 테스트, SwiftUI 미리보기 등 여러 환경에서 동작하는 모듈을 만들 때
- 액터와 `Sendable` 등 Swift 동시성 기능을 활용해 테스트하기 쉬운 아키텍처를 설계할 때

## 핵심 패턴

### 1. 작고 역할이 분명한 프로토콜 정의

각 프로토콜은 외부 의존성의 한 가지 책임만 맡습니다.

```swift
// File system access
public protocol FileSystemProviding: Sendable {
    func containerURL(for purpose: Purpose) -> URL?
}

// File read/write operations
public protocol FileAccessorProviding: Sendable {
    func read(from url: URL) throws -> Data
    func write(_ data: Data, to url: URL) throws
    func fileExists(at url: URL) -> Bool
}

// Bookmark storage (e.g., for sandboxed apps)
public protocol BookmarkStorageProviding: Sendable {
    func saveBookmark(_ data: Data, for key: String) throws
    func loadBookmark(for key: String) throws -> Data?
}
```

### 2. 프로덕션용 기본 구현 작성

```swift
public struct DefaultFileSystemProvider: FileSystemProviding {
    public init() {}

    public func containerURL(for purpose: Purpose) -> URL? {
        FileManager.default.url(forUbiquityContainerIdentifier: nil)
    }
}

public struct DefaultFileAccessor: FileAccessorProviding {
    public init() {}

    public func read(from url: URL) throws -> Data {
        try Data(contentsOf: url)
    }

    public func write(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: .atomic)
    }

    public func fileExists(at url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }
}
```

### 3. 테스트용 Mock 구현 작성

```swift
public final class MockFileAccessor: FileAccessorProviding, @unchecked Sendable {
    public var files: [URL: Data] = [:]
    public var readError: Error?
    public var writeError: Error?

    public init() {}

    public func read(from url: URL) throws -> Data {
        if let error = readError { throw error }
        guard let data = files[url] else {
            throw CocoaError(.fileReadNoSuchFile)
        }
        return data
    }

    public func write(_ data: Data, to url: URL) throws {
        if let error = writeError { throw error }
        files[url] = data
    }

    public func fileExists(at url: URL) -> Bool {
        files[url] != nil
    }
}
```

### 4. 기본 매개변수를 활용한 의존성 주입

프로덕션 코드에서는 기본 구현을 사용하고, 테스트에서는 Mock을 주입합니다.

```swift
public actor SyncManager {
    private let fileSystem: FileSystemProviding
    private let fileAccessor: FileAccessorProviding

    public init(
        fileSystem: FileSystemProviding = DefaultFileSystemProvider(),
        fileAccessor: FileAccessorProviding = DefaultFileAccessor()
    ) {
        self.fileSystem = fileSystem
        self.fileAccessor = fileAccessor
    }

    public func sync() async throws {
        guard let containerURL = fileSystem.containerURL(for: .sync) else {
            throw SyncError.containerNotAvailable
        }
        let data = try fileAccessor.read(
            from: containerURL.appendingPathComponent("data.json")
        )
        // Process data...
    }
}
```

### 5. Swift Testing으로 테스트 작성

```swift
import Testing

@Test("Sync manager handles missing container")
func testMissingContainer() async {
    let mockFileSystem = MockFileSystemProvider(containerURL: nil)
    let manager = SyncManager(fileSystem: mockFileSystem)

    await #expect(throws: SyncError.containerNotAvailable) {
        try await manager.sync()
    }
}

@Test("Sync manager reads data correctly")
func testReadData() async throws {
    let mockFileAccessor = MockFileAccessor()
    mockFileAccessor.files[testURL] = testData

    let manager = SyncManager(fileAccessor: mockFileAccessor)
    let result = try await manager.loadData()

    #expect(result == expectedData)
}

@Test("Sync manager handles read errors gracefully")
func testReadError() async {
    let mockFileAccessor = MockFileAccessor()
    mockFileAccessor.readError = CocoaError(.fileReadCorruptFile)

    let manager = SyncManager(fileAccessor: mockFileAccessor)

    await #expect(throws: SyncError.self) {
        try await manager.sync()
    }
}
```

## 모범 사례

- **단일 책임** — 프로토콜 하나에 한 가지 책임만 부여하세요. 여러 메서드를 한데 모은 거대 프로토콜은 피하세요.
- **`Sendable` 준수** — 프로토콜 타입의 값이 액터 경계를 넘을 때 필요합니다.
- **기본 매개변수** — 프로덕션 코드에서는 실제 구현이 기본값이 되게 하세요. 테스트에서만 Mock을 지정하면 됩니다.
- **오류 시뮬레이션** — Mock에 오류를 설정할 수 있는 프로퍼티를 두어 실패 경로를 테스트하세요.
- **외부 경계에만 Mock 사용** — 파일 시스템, 네트워크, API 같은 외부 의존성에만 Mock을 적용하세요.

## 피해야 할 안티패턴

- 모든 외부 접근을 하나의 거대한 프로토콜에 담기
- 외부 의존성이 없는 내부 타입을 Mock으로 대체하기
- 의존성 주입이 필요한 곳을 `#if DEBUG` 조건부 컴파일로 처리하기
- 액터 경계를 넘는 타입의 `Sendable` 준수를 빠뜨리기
- 외부 의존성이 없는 타입에도 프로토콜을 도입해 설계를 복잡하게 만들기

## 활용 사례

- 파일 시스템, 네트워크, 외부 API를 사용하는 Swift 코드
- 실제 환경에서 재현하기 어려운 오류 처리 경로 테스트
- 앱, 테스트, SwiftUI 미리보기에서 모두 동작해야 하는 모듈
- 액터나 구조적 동시성 같은 Swift 동시성 기능을 사용하면서 테스트하기 쉬운 아키텍처가 필요한 앱
