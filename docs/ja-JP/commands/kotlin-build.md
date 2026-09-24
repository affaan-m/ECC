---
description: Kotlin/Gradleビルドエラー、コンパイラ警告、依存関係の問題をインクリメンタルに修正します。最小限の外科的修正のためにkotlin-build-resolverエージェントを呼び出します。
---

# Kotlinビルドと修正

このコマンドは**kotlin-build-resolver**エージェントを呼び出し、Kotlinビルドエラーを最小限の変更でインクリメンタルに修正します。

## このコマンドの動作

1. **診断を実行**: `./gradlew build`、`detekt`、`ktlintCheck`を実行
2. **エラーを解析**: ファイルごとにグループ化し、重大度でソート
3. **インクリメンタルに修正**: 一度に1つのエラー
4. **各修正を検証**: 各変更後にビルドを再実行
5. **サマリーを報告**: 修正されたものと残りを表示

## 使用するタイミング

`/kotlin-build`を使用するのは:
- `./gradlew build`がエラーで失敗する場合
- Kotlinコンパイラがエラーを報告する場合
- `./gradlew detekt`が違反を報告する場合
- Gradle依存関係の解決が失敗する場合
- ビルドを壊す変更をプルした後

## 実行される診断コマンド

```bash
# プライマリビルドチェック
./gradlew build 2>&1

# 静的解析
./gradlew detekt 2>&1 || echo "detekt not configured"
./gradlew ktlintCheck 2>&1 || echo "ktlint not configured"

# 依存関係の問題
./gradlew dependencies --configuration runtimeClasspath 2>&1 | head -100

# キャッシュや依存関係メタデータが疑わしい場合のオプションの深いリフレッシュ
./gradlew build --refresh-dependencies
```

## セッション例

````text
User: /kotlin-build

Agent:
# Kotlinビルド解決

## 初期診断

```bash
$ ./gradlew build
e: src/main/kotlin/com/example/service/UserService.kt:25:15 Unresolved reference: UserRepository
e: src/main/kotlin/com/example/routes/UserRoutes.kt:42:9 Type mismatch: inferred type is String but Int was expected
e: src/main/kotlin/com/example/routes/UserRoutes.kt:58:5 'when' expression must be exhaustive
```

検出されたエラー: 3

## 修正 1: 未解決の参照

File: src/main/kotlin/com/example/service/UserService.kt:25
Error: Unresolved reference: UserRepository
Cause: importの欠落

```kotlin
// importを追加
import com.example.repository.UserRepository
```

```bash
$ ./gradlew build
# 残りエラー: 2
```

## 修正 2: 型の不一致

File: src/main/kotlin/com/example/routes/UserRoutes.kt:42
Error: Type mismatch: inferred type is String but Int was expected

```kotlin
// 変更前
val count = call.parameters["count"]
// 変更後
val count = call.parameters["count"]?.toIntOrNull()
    ?: return@get call.respond(HttpStatusCode.BadRequest, "Invalid count")
```

```bash
$ ./gradlew build
# 残りエラー: 1
```

## 修正 3: 非網羅的なWhen

File: src/main/kotlin/com/example/routes/UserRoutes.kt:58
Error: 'when' expression must be exhaustive

```kotlin
// 欠落ブランチを追加
when (user.role) {
    Role.ADMIN -> handleAdmin(user)
    Role.USER -> handleUser(user)
    Role.MODERATOR -> handleModerator(user) // 追加
}
```

```bash
$ ./gradlew build
# ビルド成功！
```

## 最終検証

```bash
$ ./gradlew detekt
# 問題なし

$ ./gradlew test
# 全テスト通過
```

## サマリー

| メトリクス | 件数 |
|-----------|------|
| 修正されたビルドエラー | 3 |
| 修正されたDetekt問題 | 0 |
| 変更されたファイル | 2 |
| 残りの問題 | 0 |

ビルドステータス: PASS: SUCCESS
````

## 一般的に修正されるエラー

| エラー | 典型的な修正 |
|--------|-------------|
| `Unresolved reference: X` | importまたは依存関係を追加 |
| `Type mismatch` | 型変換または代入を修正 |
| `'when' must be exhaustive` | 欠落したsealedクラスのブランチを追加 |
| `Suspend function can only be called from coroutine` | `suspend`修飾子を追加 |
| `Smart cast impossible` | ローカル`val`または`let`を使用 |
| `None of the following candidates is applicable` | 引数の型を修正 |
| `Could not resolve dependency` | バージョンを修正またはリポジトリを追加 |

## 修正戦略

1. **ビルドエラーを最初に** — コードがコンパイルされなければならない
2. **Detekt違反を次に** — コード品質の問題を修正
3. **ktlint警告を3番目に** — フォーマットを修正
4. **一度に1つの修正** — 各変更を検証
5. **最小限の変更** — リファクタリングせず、修正のみ

## 停止条件

エージェントは以下の場合に停止して報告する:
- 3回の試行後も同じエラーが持続
- 修正がより多くのエラーを導入
- アーキテクチャ変更が必要
- 外部依存関係が不足

## 関連コマンド

- `/kotlin-test` — ビルド成功後にテストを実行
- `/kotlin-review` — コード品質をレビュー
- `verification-loop`スキル — 完全な検証ループ

## 関連

- エージェント: `agents/kotlin-build-resolver.md`
- スキル: `skills/kotlin-patterns/`
