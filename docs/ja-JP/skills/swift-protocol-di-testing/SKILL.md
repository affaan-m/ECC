---
name: swift-protocol-di-testing
description: テスト可能なSwiftコードのためのプロトコルベースの依存性注入——焦点を絞ったプロトコルとSwift Testingを使用してファイルシステム、ネットワーク、外部APIをモックする。
origin: ECC
---

# プロトコルベースのSwift依存性注入テスト

外部の依存関係（ファイルシステム、ネットワーク、iCloud）を小さく焦点を絞ったプロトコルとして抽象化することで、SwiftコードをテストしやすくするパターンI/Oなしの決定論的テストをサポートする。

## 起動条件

* ファイルシステム、ネットワーク、または外部APIにアクセスするSwiftコードを書く場合
* 実際の障害を起こさずにエラー処理パスをテストする必要がある場合
* 異なる環境（アプリ、テスト、SwiftUIプレビュー）で動作するモジュールを構築する場合
* Swift並行処理（Actor、Sendable）をサポートするテスト可能なアーキテクチャを設計する場合

## コアパターン

### 1. 小さく焦点を絞ったプロトコルを定義する

各プロトコルは1つの外部関心事のみを処理する。

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

### 2. デフォルト（本番用）実装を作成する

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

### 3. テスト用のモック実装を作成する

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

### 4. デフォルトパラメーターで依存関係を注入する

本番コードはデフォルト値を使用し、テストはモックを注入する。

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

### 5. Swift Testingを使用してテストを書く

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

## ベストプラクティス

* **単一責任**：各プロトコルは1つの関心事を処理する——多くのメソッドを持つ「ゴッドプロトコル」を作らない
* **Sendable 一貫性**：プロトコルがActor境界をまたいで使用される場合に必要
* **デフォルトパラメーター**：本番コードは実際の実装をデフォルトで使用する。テストだけがモックを指定する必要がある
* **エラーのモック**：障害パスをテストするために設定可能なエラープロパティを持つモックを設計する
* **境界のみをモック**：外部の依存関係（ファイルシステム、ネットワーク、API）をモックし、内部型はモックしない

## 避けるべきアンチパターン

* すべての外部アクセスをカバーする単一の大きなプロトコルを作成する
* 外部の依存関係を持たない内部型をモックする
* 適切な依存性注入の代わりに `#if DEBUG` 条件文を使用する
* Actorと組み合わせて使用する際に `Sendable` 一貫性を忘れる
* 過度な設計：型が外部の依存関係を持たない場合、プロトコルは必要ない

## 使用場面

* ファイルシステム、ネットワーク、または外部APIに触れるあらゆるSwiftコード
* 実際の環境では引き起こすことが難しいエラー処理パスをテストする場合
* アプリ、テスト、SwiftUIプレビューのコンテキストで動作するモジュールを構築する場合
* Swift並行処理（Actor、構造化並行処理）を採用したテスト可能なアーキテクチャが必要なアプリ
