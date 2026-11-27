---
description: Goビルドエラー、go vet警告、リンター問題を段階的に修正します。最小限の外科的修正のためにgo-build-resolverエージェントを呼び出します。
---

# Go Build and Fix

このコマンドは**go-build-resolver**エージェントを呼び出し、最小限の変更でGoビルドエラーを段階的に修正します。

## このコマンドの機能

1. **診断の実行**: `go build`、`go vet`、`staticcheck`を実行
2. **エラーの解析**: ファイル別にグループ化し、重要度順にソート
3. **段階的修正**: 一度に1つのエラーを修正
4. **各修正の検証**: 各変更後にビルドを再実行
5. **サマリーのレポート**: 修正されたものと残っているものを表示

## 使用するタイミング

以下の場合に`/go-build`を使用します:
- `go build ./...`がエラーで失敗する場合
- `go vet ./...`が問題を報告する場合
- `golangci-lint run`が警告を表示する場合
- モジュール依存関係が壊れている場合
- ビルドを壊す変更をプルした後

## 実行される診断コマンド

```bash
# プライマリビルドチェック
go build ./...

# 静的解析
go vet ./...

# 拡張リンティング(利用可能な場合)
staticcheck ./...
golangci-lint run

# モジュール問題
go mod verify
go mod tidy -v
```

## セッション例

```text
User: /go-build

Agent:
# Goビルド解決

## 初期診断

```bash
$ go build ./...
internal/service/user.go:25:15: undefined: UserRepository
internal/handler/api.go:42:9: cannot use x (type string) as type int
internal/handler/api.go:58:2: missing return at end of function
```

エラー検出: 3件

## 修正1: 未定義の識別子

ファイル: internal/service/user.go:25
エラー: undefined: UserRepository
原因: インポート欠落

```go
// インポートを追加
import "project/internal/repository"

// 変更前
var repo UserRepository
// 変更後
var repo repository.UserRepository
```

```bash
$ go build ./...
# 残り2件のエラー
```

## 修正2: 型の不一致

ファイル: internal/handler/api.go:42
エラー: cannot use x (type string) as type int

```go
// 変更前
count := params.Get("count")
// 変更後
countStr := params.Get("count")
count, _ := strconv.Atoi(countStr)
```

```bash
$ go build ./...
# 残り1件のエラー
```

## 修正3: 戻り値の欠落

ファイル: internal/handler/api.go:58
エラー: missing return at end of function

```go
func GetUser(id string) (*User, error) {
    if id == "" {
        return nil, ErrInvalidID
    }
    user := findUser(id)
    // 欠落していた戻り値を追加
    return user, nil
}
```

```bash
$ go build ./...
# ビルド成功!
```

## 最終検証

```bash
$ go vet ./...
# 問題なし

$ go test ./...
ok      project/internal/service   0.015s
ok      project/internal/handler   0.023s
```

## サマリー

| 指標 | 件数 |
|--------|-------|
| 修正されたビルドエラー | 3 |
| 修正されたVet警告 | 0 |
| 変更されたファイル | 2 |
| 残存問題 | 0 |

ビルドステータス: PASS: 成功
```

## 修正される一般的なエラー

| エラー | 典型的な修正 |
|-------|-------------|
| `undefined: X` | インポートを追加またはタイプミスを修正 |
| `cannot use X as Y` | 型変換または代入を修正 |
| `missing return` | return文を追加 |
| `X does not implement Y` | 欠落しているメソッドを追加 |
| `import cycle` | パッケージを再構築 |
| `declared but not used` | 変数を削除または使用 |
| `cannot find package` | `go get`または`go mod tidy` |

## 修正戦略

1. **まずビルドエラー** - コードがコンパイルできる必要がある
2. **次にVet警告** - 疑わしい構造を修正
3. **最後にLint警告** - スタイルとベストプラクティス
4. **一度に1つの修正** - 各変更を検証
5. **最小限の変更** - リファクタリングではなく、修正のみ

## 停止条件

以下の場合、エージェントは停止してレポートします:
- 同じエラーが3回の試行後も持続
- 修正がさらなるエラーを引き起こす
- アーキテクチャの変更が必要
- 外部依存関係が欠落

## 関連コマンド

- `/go-test` - ビルド成功後にテストを実行
- `/go-review` - コード品質をレビュー
- `/verify` - 完全な検証ループ

## 関連

- Agent: `agents/go-build-resolver.md`
- Skill: `skills/golang-patterns/`
