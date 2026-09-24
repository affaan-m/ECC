---
paths:
  - "**/*.swift"
  - "**/Package.swift"
---
# Swift テスト

> このファイルは [common/testing.md](../common/testing.md) を Swift 固有のコンテンツで拡張します。

## フレームワーク

新しいテストには **Swift Testing**（`import Testing`）を使用する。`@Test` と `#expect` を使用する:

```swift
@Test("User creation validates email")
func userCreationValidatesEmail() throws {
    #expect(throws: ValidationError.invalidEmail) {
        try User(email: "not-an-email")
    }
}
```

## テストの分離

各テストは新しいインスタンスを取得する — `init` でセットアップし、`deinit` でティアダウンする。テスト間で共有ミュータブル状態を持たない。

## パラメータ化テスト

```swift
@Test("Validates formats", arguments: ["json", "xml", "csv"])
func validatesFormat(format: String) throws {
    let parser = try Parser(format: format)
    #expect(parser.isValid)
}
```

## カバレッジ

```bash
swift test --enable-code-coverage
```

## 参考

プロトコルベースの依存性注入と Swift Testing によるモックパターンについてはスキル: `swift-protocol-di-testing` を参照。
