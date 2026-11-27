---
description: Goのテスト駆動開発(TDD)ワークフローを適用します。テーブル駆動テストを最初に記述し、その後実装します。go test -coverで80%以上のカバレッジを確認します。
---

# Go TDD コマンド

このコマンドは、Goのイディオム的なテストパターンを使用したテスト駆動開発手法を適用します。

## このコマンドの機能

1. **型/インターフェースの定義**: 関数シグネチャを最初にスキャフォールディング
2. **テーブル駆動テストの作成**: 包括的なテストケースを作成(RED)
3. **テストの実行**: テストが正しい理由で失敗することを確認
4. **コードの実装**: テストをパスするための最小限のコードを記述(GREEN)
5. **リファクタリング**: テストをグリーンに保ちながら改善
6. **カバレッジの確認**: 80%以上のカバレッジを保証

## 使用するタイミング

`/go-test` は次の場合に使用します:
- 新しいGo関数の実装時
- 既存コードへのテストカバレッジ追加時
- バグ修正時(失敗するテストを最初に作成)
- 重要なビジネスロジックの構築時
- GoでのTDDワークフローの学習時

## TDD サイクル

```
RED     → 失敗するテーブル駆動テストを作成
GREEN   → テストをパスするための最小限のコードを実装
REFACTOR → コードを改善、テストはグリーンを保持
REPEAT  → 次のテストケースへ
```

## セッション例

```text
User: /go-test メールアドレスを検証する関数が必要です

Agent:
# TDD セッション: メールバリデーター

## ステップ 1: インターフェースの定義

```go
// validator/email.go
package validator

// ValidateEmail checks if the given string is a valid email address.
// Returns nil if valid, error describing the issue otherwise.
func ValidateEmail(email string) error {
    panic("not implemented")
}
```

## ステップ 2: テーブル駆動テストの作成 (RED)

```go
// validator/email_test.go
package validator

import (
    "testing"
)

func TestValidateEmail(t *testing.T) {
    tests := []struct {
        name    string
        email   string
        wantErr bool
    }{
        // 有効なメールアドレス
        {"simple email", "user@example.com", false},
        {"with subdomain", "user@mail.example.com", false},
        {"with plus", "user+tag@example.com", false},
        {"with dots", "first.last@example.com", false},

        // 無効なメールアドレス
        {"empty string", "", true},
        {"no at sign", "userexample.com", true},
        {"no domain", "user@", true},
        {"no local part", "@example.com", true},
        {"double at", "user@@example.com", true},
        {"spaces", "user @example.com", true},
        {"no tld", "user@example", true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := ValidateEmail(tt.email)
            if tt.wantErr && err == nil {
                t.Errorf("ValidateEmail(%q) = nil; want error", tt.email)
            }
            if !tt.wantErr && err != nil {
                t.Errorf("ValidateEmail(%q) = %v; want nil", tt.email, err)
            }
        })
    }
}
```

## ステップ 3: テストの実行 - 失敗を確認

```bash
$ go test ./validator/...

--- FAIL: TestValidateEmail (0.00s)
    --- FAIL: TestValidateEmail/simple_email (0.00s)
        panic: not implemented

FAIL
```

✓ テストが期待通り失敗しました(panic)。

## ステップ 4: 最小限のコード実装 (GREEN)

```go
// validator/email.go
package validator

import (
    "errors"
    "regexp"
)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

var (
    ErrEmailEmpty   = errors.New("email cannot be empty")
    ErrEmailInvalid = errors.New("email format is invalid")
)

func ValidateEmail(email string) error {
    if email == "" {
        return ErrEmailEmpty
    }
    if !emailRegex.MatchString(email) {
        return ErrEmailInvalid
    }
    return nil
}
```

## ステップ 5: テストの実行 - パスを確認

```bash
$ go test ./validator/...

PASS
ok      project/validator    0.003s
```

✓ すべてのテストが通りました!

## ステップ 6: カバレッジの確認

```bash
$ go test -cover ./validator/...

PASS
coverage: 100.0% of statements
ok      project/validator    0.003s
```

✓ カバレッジ: 100%

## TDD 完了!
```

## テストパターン

### テーブル駆動テスト
```go
tests := []struct {
    name     string
    input    InputType
    want     OutputType
    wantErr  bool
}{
    {"case 1", input1, want1, false},
    {"case 2", input2, want2, true},
}

for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        got, err := Function(tt.input)
        // assertions
    })
}
```

### 並列テスト
```go
for _, tt := range tests {
    tt := tt // Capture
    t.Run(tt.name, func(t *testing.T) {
        t.Parallel()
        // test body
    })
}
```

### テストヘルパー
```go
func setupTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db := createDB()
    t.Cleanup(func() { db.Close() })
    return db
}
```

## カバレッジコマンド

```bash
# 基本的なカバレッジ
go test -cover ./...

# カバレッジプロファイル
go test -coverprofile=coverage.out ./...

# ブラウザで表示
go tool cover -html=coverage.out

# 関数ごとのカバレッジ
go tool cover -func=coverage.out

# レース検出付き
go test -race -cover ./...
```

## カバレッジ目標

| コードタイプ | 目標 |
|-----------|--------|
| 重要なビジネスロジック | 100% |
| パブリックAPI | 90%+ |
| 一般的なコード | 80%+ |
| 生成されたコード | 除外 |

## TDD ベストプラクティス

**推奨事項:**
- 実装前にテストを最初に書く
- 各変更後にテストを実行
- 包括的なカバレッジのためにテーブル駆動テストを使用
- 実装の詳細ではなく動作をテスト
- エッジケースを含める(空、nil、最大値)

**避けるべき事項:**
- テストの前に実装を書く
- REDフェーズをスキップする
- プライベート関数を直接テスト
- テストで`time.Sleep`を使用
- 不安定なテストを無視する

## 関連コマンド

- `/go-build` - ビルドエラーの修正
- `/go-review` - 実装後のコードレビュー
- `/verify` - 完全な検証ループの実行

## 関連

- スキル: `skills/golang-testing/`
- スキル: `skills/tdd-workflow/`
