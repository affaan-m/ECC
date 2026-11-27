---
paths:
  - "**/*.swift"
  - "**/Package.swift"
---
# Swift パターン

> このファイルは [common/patterns.md](../common/patterns.md) を Swift 固有のコンテンツで拡張します。

## プロトコル指向設計

小さく焦点を絞ったプロトコルを定義する。共有デフォルトにはプロトコル拡張を使用する:

```swift
protocol Repository: Sendable {
    associatedtype Item: Identifiable & Sendable
    func find(by id: Item.ID) async throws -> Item?
    func save(_ item: Item) async throws
}
```

## 値型

- データ転送オブジェクトとモデルには構造体を使用する
- 異なる状態をモデリングするには関連値付きの列挙型を使用する:

```swift
enum LoadState<T: Sendable>: Sendable {
    case idle
    case loading
    case loaded(T)
    case failed(Error)
}
```

## アクターパターン

ロックやディスパッチキューの代わりに、共有ミュータブル状態にはアクターを使用する:

```swift
actor Cache<Key: Hashable & Sendable, Value: Sendable> {
    private var storage: [Key: Value] = [:]

    func get(_ key: Key) -> Value? { storage[key] }
    func set(_ key: Key, value: Value) { storage[key] = value }
}
```

## 依存性注入

デフォルトパラメータ付きでプロトコルを注入する — 本番ではデフォルトを使用し、テストではモックを注入する:

```swift
struct UserService {
    private let repository: any UserRepository

    init(repository: any UserRepository = DefaultUserRepository()) {
        self.repository = repository
    }
}
```

## 参考

アクターベースの永続化パターンについてはスキル: `swift-actor-persistence` を参照。
プロトコルベースの DI とテストについてはスキル: `swift-protocol-di-testing` を参照。
