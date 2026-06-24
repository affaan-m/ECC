---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Go テスト

> このファイルは [common/testing.md](../common/testing.md) を Go 固有のコンテンツで拡張します。

## フレームワーク

標準の `go test` と**テーブル駆動テスト**を使用する。

## 競合検出

常に `-race` フラグを付けて実行する:

```bash
go test -race ./...
```

## カバレッジ

```bash
go test -cover ./...
```

## リファレンス

スキル: `golang-testing` で詳細な Go テストパターンとヘルパーを参照してください。
