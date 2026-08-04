---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Go フック

> このファイルは [common/hooks.md](../common/hooks.md) を Go 固有のコンテンツで拡張します。

## PostToolUse フック

`~/.claude/settings.json` で設定:

- **gofmt/goimports**: 編集後に `.go` ファイルを自動フォーマット
- **go vet**: `.go` ファイル編集後に静的解析を実行
- **staticcheck**: 変更されたパッケージに対して拡張静的チェックを実行
