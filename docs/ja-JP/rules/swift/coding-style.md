---
paths:
  - "**/*.swift"
  - "**/Package.swift"
---
# Swift コーディングスタイル

> このファイルは [common/coding-style.md](../common/coding-style.md) を Swift 固有のコンテンツで拡張します。

## フォーマット

- 自動フォーマットには **SwiftFormat**、スタイル強制には **SwiftLint** を使用する
- Xcode 16+ には代替として `swift-format` がバンドルされている

## 不変性

- `var` よりも `let` を優先する — すべてを `let` で定義し、コンパイラが要求する場合にのみ `var` に変更する
- デフォルトで値セマンティクスの `struct` を使用する。同一性や参照セマンティクスが必要な場合にのみ `class` を使用する

## 命名

[Apple API デザインガイドライン](https://www.swift.org/documentation/api-design-guidelines/) に従う:

- 使用箇所での明確さ — 不要な単語を省く
- メソッドとプロパティは型ではなく役割にちなんだ名前を付ける
- グローバル定数よりも `static let` を定数に使用する

## エラーハンドリング

型付き throws（Swift 6+）とパターンマッチングを使用する:

```swift
func load(id: String) throws(LoadError) -> Item {
    guard let data = try? read(from: path) else {
        throw .fileNotFound(id)
    }
    return try decode(data)
}
```

## 並行性

Swift 6 の厳格な並行性チェックを有効にする。以下を優先する:

- 隔離境界をまたぐデータには `Sendable` 値型
- 共有ミュータブル状態にはアクター
- 非構造化 `Task {}` よりも構造化された並行性（`async let`、`TaskGroup`）
