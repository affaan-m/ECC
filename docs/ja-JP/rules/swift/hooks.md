---
paths:
  - "**/*.swift"
  - "**/Package.swift"
---
# Swift フック

> このファイルは [common/hooks.md](../common/hooks.md) を Swift 固有のコンテンツで拡張します。

## PostToolUse フック

`~/.claude/settings.json` で設定する:

- **SwiftFormat**: `.swift` ファイルを編集後に自動フォーマットする
- **SwiftLint**: `.swift` ファイルの編集後にリントチェックを実行する
- **swift build**: 編集後に変更されたパッケージを型チェックする

## 警告

`print()` 文にフラグを立てる — 本番コードでは代わりに `os.Logger` または構造化ロギングを使用する。
