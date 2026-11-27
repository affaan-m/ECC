---
description: Kotlinコードのイディオムパターン、nullセーフティ、コルーチンの安全性、セキュリティに関する包括的なコードレビュー。kotlin-reviewerエージェントを呼び出します。
---

# Kotlinコードレビュー

このコマンドは**kotlin-reviewer**エージェントを呼び出し、Kotlin固有の包括的なコードレビューを行います。

## このコマンドの動作

1. **Kotlinの変更を特定**: `git diff`で変更された`.kt`と`.kts`ファイルを検出
2. **ビルドと静的解析を実行**: `./gradlew build`、`detekt`、`ktlintCheck`を実行
3. **セキュリティスキャン**: SQLインジェクション、コマンドインジェクション、ハードコードされたシークレットを確認
4. **Nullセーフティレビュー**: `!!`の使用、プラットフォーム型の処理、安全でないキャストを分析
5. **コルーチンレビュー**: 構造化された並行性、ディスパッチャーの使用、キャンセレーションを確認
6. **レポートを生成**: 重大度別に問題を分類

## 使用するタイミング

`/kotlin-review`を使用するのは:
- Kotlinコードを書いたり変更した後
- Kotlinの変更をコミットする前
- Kotlinコードを含むプルリクエストをレビューする時
- 新しいKotlinコードベースにオンボーディングする時
- イディオマティックなKotlinパターンを学ぶ時

## レビューカテゴリ

### CRITICAL（修正必須）
- SQL/コマンドインジェクション脆弱性
- 正当化なしの強制アンラップ`!!`
- プラットフォーム型のnullセーフティ違反
- GlobalScopeの使用（構造化された並行性の違反）
- ハードコードされた認証情報
- 安全でないデシリアライゼーション

### HIGH（修正すべき）
- イミュータブルで十分な場合のミュータブルな状態
- コルーチンコンテキスト内でのブロッキングコール
- 長いループでのキャンセレーションチェックの欠落
- sealed型に対する非網羅的な`when`
- 大きな関数（50行超）
- 深いネスト（4レベル超）

### MEDIUM（検討すべき）
- 非イディオマティックなKotlin（Javaスタイルのパターン）
- トレイリングカンマの欠落
- スコープ関数の誤用やネスト
- 大きなコレクションチェーンでのsequenceの欠落
- 冗長な明示的型

## 実行される自動チェック

```bash
# ビルドチェック
./gradlew build

# 静的解析
./gradlew detekt

# フォーマットチェック
./gradlew ktlintCheck

# テスト
./gradlew test
```

## 使用例

````text
User: /kotlin-review

Agent:
# Kotlinコードレビューレポート

## レビュー対象ファイル
- src/main/kotlin/com/example/service/UserService.kt（変更）
- src/main/kotlin/com/example/routes/UserRoutes.kt（変更）

## 静的解析結果
✓ ビルド: 成功
✓ detekt: 問題なし
WARNING: ktlint: フォーマット警告2件

## 検出された問題

[CRITICAL] 強制アンラップNullセーフティ
File: src/main/kotlin/com/example/service/UserService.kt:28
Issue: nullableなリポジトリ結果に!!を使用
```kotlin
val user = repository.findById(id)!!  // NPEリスク
```
Fix: セーフコールとエラーハンドリングを使用
```kotlin
val user = repository.findById(id)
    ?: throw UserNotFoundException("User $id not found")
```

[HIGH] GlobalScopeの使用
File: src/main/kotlin/com/example/routes/UserRoutes.kt:45
Issue: GlobalScopeの使用は構造化された並行性を壊す
```kotlin
GlobalScope.launch {
    notificationService.sendWelcome(user)
}
```
Fix: コールのコルーチンスコープを使用
```kotlin
launch {
    notificationService.sendWelcome(user)
}
```

## サマリー
- CRITICAL: 1
- HIGH: 1
- MEDIUM: 0

推奨: FAIL: CRITICALの問題が修正されるまでマージをブロック
````

## 承認基準

| ステータス | 条件 |
|-----------|------|
| PASS: 承認 | CRITICALまたはHIGHの問題がない |
| WARNING: 警告 | MEDIUMの問題のみ（注意してマージ） |
| FAIL: ブロック | CRITICALまたはHIGHの問題が検出 |

## 他のコマンドとの統合

- まず`/kotlin-test`を使用してテストが通ることを確認
- ビルドエラーが発生した場合は`/kotlin-build`を使用
- コミット前に`/kotlin-review`を使用
- Kotlin固有でない懸念には`/code-review`を使用

## 関連

- エージェント: `agents/kotlin-reviewer.md`
- スキル: `skills/kotlin-patterns/`、`skills/kotlin-testing/`
