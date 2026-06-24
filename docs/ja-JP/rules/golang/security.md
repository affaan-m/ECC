---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Go セキュリティ

> このファイルは [common/security.md](../common/security.md) を Go 固有のコンテンツで拡張します。

## シークレット管理

```go
apiKey := os.Getenv("OPENAI_API_KEY")
if apiKey == "" {
    log.Fatal("OPENAI_API_KEY not configured")
}
```

## セキュリティスキャン

- **gosec** を使用して静的セキュリティ解析を実行:
  ```bash
  gosec ./...
  ```

## Context とタイムアウト

タイムアウト制御には常に `context.Context` を使用する:

```go
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()
```
