# Go マイクロサービス — プロジェクト CLAUDE.md

> PostgreSQL、gRPC、Dockerを使用したGoマイクロサービスの実世界サンプル。
> これをプロジェクトのルートにコピーしてサービスに合わせてカスタマイズしてください。

## プロジェクト概要

**スタック:** Go 1.22+, PostgreSQL, gRPC + REST (grpc-gateway), Docker, sqlc (型安全SQL), Wire (依存性注入)

**アーキテクチャ:** ドメイン、リポジトリ、サービス、ハンドラーレイヤーを持つクリーンアーキテクチャ。gRPCをプライマリトランスポートとし、外部クライアント向けにRESTゲートウェイを提供。

## 重要なルール

### Go の規約

- Effective Goと Go Code Review Comments ガイドに従う
- エラーのラッピングには `errors.New` / `fmt.Errorf` に `%w` を使用 — エラーに対する文字列マッチングは禁止
- `init()` 関数は使用しない — `main()` またはコンストラクターで明示的に初期化する
- グローバルな可変状態は使用しない — コンストラクター経由で依存関係を渡す
- コンテキストは最初のパラメーターにし、すべてのレイヤーを通じて伝播させること

### データベース

- すべてのクエリは `queries/` にプレーンSQLとして記述 — sqlcが型安全なGoコードを生成
- `migrations/` のマイグレーションはgolang-migrateを使用 — データベースを直接変更しない
- 複数ステップの操作には `pgx.Tx` を使用してトランザクションを使用する
- すべてのクエリはパラメータ化プレースホルダー（`$1`, `$2`）を使用 — 文字列フォーマットは禁止

### エラーハンドリング

- パニックしない、エラーを返す — パニックは本当に回復不可能な状況のみ
- コンテキストと共にエラーをラップする: `fmt.Errorf("creating user: %w", err)`
- ビジネスロジック用のセンチネルエラーを `domain/errors.go` に定義する
- ハンドラーレイヤーでドメインエラーをgRPCステータスコードにマップする

```go
// ドメインレイヤー — センチネルエラー
var (
    ErrUserNotFound  = errors.New("user not found")
    ErrEmailTaken    = errors.New("email already registered")
)

// ハンドラーレイヤー — gRPCステータスにマップ
func toGRPCError(err error) error {
    switch {
    case errors.Is(err, domain.ErrUserNotFound):
        return status.Error(codes.NotFound, err.Error())
    case errors.Is(err, domain.ErrEmailTaken):
        return status.Error(codes.AlreadyExists, err.Error())
    default:
        return status.Error(codes.Internal, "internal error")
    }
}
```

### コードスタイル

- コードやコメントに絵文字を使用しない
- エクスポートされた型と関数にはドキュメントコメントが必要
- 関数は50行以内に収める — ヘルパーを抽出する
- 複数のケースを持つすべてのロジックにはテーブル駆動テストを使用する
- シグナルチャンネルには `bool` ではなく `struct{}` を優先する

## ファイル構成

```
cmd/
  server/
    main.go              # エントリーポイント、Wire注入、グレースフルシャットダウン
internal/
  domain/                # ビジネス型とインターフェース
    user.go              # ユーザーエンティティとリポジトリインターフェース
    errors.go            # センチネルエラー
  service/               # ビジネスロジック
    user_service.go
    user_service_test.go
  repository/            # データアクセス（sqlc生成 + カスタム）
    postgres/
      user_repo.go
      user_repo_test.go  # testcontainersを使用した統合テスト
  handler/               # gRPC + RESTハンドラー
    grpc/
      user_handler.go
    rest/
      user_handler.go
  config/                # 設定の読み込み
    config.go
proto/                   # Protobuf定義
  user/v1/
    user.proto
queries/                 # sqlc用SQLクエリ
  user.sql
migrations/              # データベースマイグレーション
  001_create_users.up.sql
  001_create_users.down.sql
```

## 主要なパターン

### リポジトリインターフェース

```go
type UserRepository interface {
    Create(ctx context.Context, user *User) error
    FindByID(ctx context.Context, id uuid.UUID) (*User, error)
    FindByEmail(ctx context.Context, email string) (*User, error)
    Update(ctx context.Context, user *User) error
    Delete(ctx context.Context, id uuid.UUID) error
}
```

### 依存性注入付きサービス

```go
type UserService struct {
    repo   domain.UserRepository
    hasher PasswordHasher
    logger *slog.Logger
}

func NewUserService(repo domain.UserRepository, hasher PasswordHasher, logger *slog.Logger) *UserService {
    return &UserService{repo: repo, hasher: hasher, logger: logger}
}

func (s *UserService) Create(ctx context.Context, req CreateUserRequest) (*domain.User, error) {
    existing, err := s.repo.FindByEmail(ctx, req.Email)
    if err != nil && !errors.Is(err, domain.ErrUserNotFound) {
        return nil, fmt.Errorf("checking email: %w", err)
    }
    if existing != nil {
        return nil, domain.ErrEmailTaken
    }

    hashed, err := s.hasher.Hash(req.Password)
    if err != nil {
        return nil, fmt.Errorf("hashing password: %w", err)
    }

    user := &domain.User{
        ID:       uuid.New(),
        Name:     req.Name,
        Email:    req.Email,
        Password: hashed,
    }
    if err := s.repo.Create(ctx, user); err != nil {
        return nil, fmt.Errorf("creating user: %w", err)
    }
    return user, nil
}
```

### テーブル駆動テスト

```go
func TestUserService_Create(t *testing.T) {
    tests := []struct {
        name    string
        req     CreateUserRequest
        setup   func(*MockUserRepo)
        wantErr error
    }{
        {
            name: "valid user",
            req:  CreateUserRequest{Name: "Alice", Email: "alice@example.com", Password: "secure123"},
            setup: func(m *MockUserRepo) {
                m.On("FindByEmail", mock.Anything, "alice@example.com").Return(nil, domain.ErrUserNotFound)
                m.On("Create", mock.Anything, mock.Anything).Return(nil)
            },
            wantErr: nil,
        },
        {
            name: "duplicate email",
            req:  CreateUserRequest{Name: "Alice", Email: "taken@example.com", Password: "secure123"},
            setup: func(m *MockUserRepo) {
                m.On("FindByEmail", mock.Anything, "taken@example.com").Return(&domain.User{}, nil)
            },
            wantErr: domain.ErrEmailTaken,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            repo := new(MockUserRepo)
            tt.setup(repo)
            svc := NewUserService(repo, &bcryptHasher{}, slog.Default())

            _, err := svc.Create(context.Background(), tt.req)

            if tt.wantErr != nil {
                assert.ErrorIs(t, err, tt.wantErr)
            } else {
                assert.NoError(t, err)
            }
        })
    }
}
```

## 環境変数

```bash
# データベース
DATABASE_URL=postgres://user:pass@localhost:5432/myservice?sslmode=disable

# gRPC
GRPC_PORT=50051
REST_PORT=8080

# 認証
JWT_SECRET=           # 本番環境ではvaultから読み込む
TOKEN_EXPIRY=24h

# オブザーバビリティ
LOG_LEVEL=info        # debug, info, warn, error
OTEL_ENDPOINT=        # OpenTelemetryコレクター
```

## テスト戦略

```bash
/go-test             # GoのTDDワークフロー
/go-review           # Go固有のコードレビュー
/go-build            # ビルドエラーの修正
```

### テストコマンド

```bash
# ユニットテスト（高速、外部依存なし）
go test ./internal/... -short -count=1

# 統合テスト（testcontainers用にDockerが必要）
go test ./internal/repository/... -count=1 -timeout 120s

# カバレッジ付きすべてのテスト
go test ./... -coverprofile=coverage.out -count=1
go tool cover -func=coverage.out  # サマリー
go tool cover -html=coverage.out  # ブラウザ

# レースディテクター
go test ./... -race -count=1
```

## ECCワークフロー

```bash
# 計画
/plan "Add rate limiting to user endpoints"

# 開発
/go-test                  # Go固有パターンでのTDD

# レビュー
/go-review                # Goのイディオム、エラーハンドリング、並行処理
/security-scan            # シークレットと脆弱性

# マージ前
go vet ./...
staticcheck ./...
```

## Git ワークフロー

- `feat:` 新機能、`fix:` バグ修正、`refactor:` コード変更
- `main` からフィーチャーブランチを切り、PRが必要
- CI: `go vet`, `staticcheck`, `go test -race`, `golangci-lint`
- デプロイ: CIでDockerイメージをビルドし、Kubernetesにデプロイ
