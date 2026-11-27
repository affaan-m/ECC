---
paths:
  - "**/*.swift"
  - "**/Package.swift"
---
# Swift セキュリティ

> このファイルは [common/security.md](../common/security.md) を Swift 固有のコンテンツで拡張します。

## シークレット管理

- 機密データ（トークン、パスワード、キー）には **Keychain Services** を使用する — `UserDefaults` は使わない
- ビルド時のシークレットには環境変数または `.xcconfig` ファイルを使用する
- ソースにシークレットをハードコードしない — 逆コンパイルツールで容易に抽出される

```swift
let apiKey = ProcessInfo.processInfo.environment["API_KEY"]
guard let apiKey, !apiKey.isEmpty else {
    fatalError("API_KEY not configured")
}
```

## トランスポートセキュリティ

- App Transport Security（ATS）はデフォルトで強制される — 無効にしない
- 重要なエンドポイントには証明書ピンニングを使用する
- すべてのサーバー証明書を検証する

## 入力バリデーション

- 表示前にすべてのユーザー入力をサニタイズしてインジェクションを防止する
- 強制アンラップではなく、バリデーション付きの `URL(string:)` を使用する
- 外部ソース（API、ディープリンク、ペーストボード）からのデータは処理前に検証する
