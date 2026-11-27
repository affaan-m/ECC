---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Go パターン

> このファイルは [common/patterns.md](../common/patterns.md) を Go 固有のコンテンツで拡張します。

## Functional Options

```go
type Option func(*Server)

func WithPort(port int) Option {
    return func(s *Server) { s.port = port }
}

func NewServer(opts ...Option) *Server {
    s := &Server{port: 8080}
    for _, opt := range opts {
        opt(s)
    }
    return s
}
```

## 小さなインターフェース

インターフェースは実装される場所ではなく、使用される場所で定義する。

## 依存性注入

コンストラクタ関数を使用して依存関係を注入する:

```go
func NewUserService(repo UserRepository, logger Logger) *UserService {
    return &UserService{repo: repo, logger: logger}
}
```

## リファレンス

スキル: `golang-patterns` で並行処理、エラーハンドリング、パッケージ構成を含む包括的な Go パターンを参照してください。
