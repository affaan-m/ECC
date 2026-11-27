---
description: 慣用的なパターン、並行性の安全性、エラーハンドリング、セキュリティについての包括的なGoコードレビュー。go-reviewerエージェントを呼び出します。
---

# Go Code Review

このコマンドは、Go固有の包括的なコードレビューのために**go-reviewer**エージェントを呼び出します。

## このコマンドの機能

1. **Go変更の特定**: `git diff`で変更された`.go`ファイルを検出
2. **静的解析の実行**: `go vet`、`staticcheck`、`golangci-lint`を実行
3. **セキュリティスキャン**: SQLインジェクション、コマンドインジェクション、競合状態をチェック
4. **並行性のレビュー**: goroutineの安全性、チャネルの使用、mutexパターンを分析
5. **慣用的なGoチェック**: コードがGoの慣習とベストプラクティスに従っていることを確認
6. **レポート生成**: 問題を重要度別に分類

## 使用するタイミング

以下の場合に`/go-review`を使用します:
- Goコードを作成または変更した後
- Go変更をコミットする前
- Goコードを含むプルリクエストのレビュー時
- 新しいGoコードベースへのオンボーディング時
- 慣用的なGoパターンの学習時

## レビューカテゴリ

### CRITICAL(必須修正)
- SQL/コマンドインジェクションの脆弱性
- 同期化なしの競合状態
- goroutineリーク
- ハードコードされた資格情報
- 安全でないポインタの使用
- クリティカルパスでのエラーの無視

### HIGH(修正推奨)
- コンテキストを含まないエラーラッピングの欠落
- エラー戻り値の代わりにパニック
- コンテキストが伝播されていない
- デッドロックを引き起こすバッファなしチャネル
- インターフェース未実装エラー
- mutexによる保護の欠落

### MEDIUM(検討)
- 非慣用的なコードパターン
- エクスポート時のgodocコメントの欠落
- 非効率的な文字列連結
- 事前割り当てされていないスライス
- テーブル駆動テストが使用されていない

## 実行される自動チェック

```bash
# 静的解析
go vet ./...

# 高度なチェック(インストールされている場合)
staticcheck ./...
golangci-lint run

# 競合検出
go build -race ./...

# セキュリティ脆弱性
govulncheck ./...
```

## 使用例

```text
User: /go-review

Agent:
# Goコードレビューレポート

## レビューされたファイル
- internal/handler/user.go (変更)
- internal/service/auth.go (変更)

## 静的解析結果
✓ go vet: 問題なし
✓ staticcheck: 問題なし

## 発見された問題

[CRITICAL] 競合状態
ファイル: internal/service/auth.go:45
問題: 同期化なしで共有マップにアクセス
```go
var cache = map[string]*Session{}  // 並行アクセス!

func GetSession(id string) *Session {
    return cache[id]  // 競合状態
}
```
修正: sync.RWMutexまたはsync.Mapを使用
```go
var (
    cache   = map[string]*Session{}
    cacheMu sync.RWMutex
)

func GetSession(id string) *Session {
    cacheMu.RLock()
    defer cacheMu.RUnlock()
    return cache[id]
}
```

[HIGH] エラーコンテキストの欠落
ファイル: internal/handler/user.go:28
問題: コンテキストなしでエラーを返す
```go
return err  // コンテキストなし
```
修正: コンテキストでラップ
```go
return fmt.Errorf("get user %s: %w", userID, err)
```

## サマリー
- CRITICAL: 1
- HIGH: 1
- MEDIUM: 0

推奨: FAIL: CRITICAL問題が修正されるまでマージをブロック
```

## 承認基準

| ステータス | 条件 |
|--------|-----------|
| PASS: 承認 | CRITICALまたはHIGH問題なし |
| WARNING: 警告 | MEDIUM問題のみ(注意してマージ) |
| FAIL: ブロック | CRITICALまたはHIGH問題が発見された |

## 他のコマンドとの統合

- まず`/go-test`を使用してテストが合格することを確認
- `/go-build`をビルドエラー発生時に使用
- `/go-review`をコミット前に使用
- `/code-review`をGo固有でない問題に使用

## 関連

- Agent: `agents/go-reviewer.md`
- Skills: `skills/golang-patterns/`, `skills/golang-testing/`
