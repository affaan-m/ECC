---
paths:
  - "**/*.kt"
  - "**/*.kts"
---
# Kotlin コーディングスタイル

> このファイルは [common/coding-style.md](../common/coding-style.md) を Kotlin 固有のコンテンツで拡張します。

## フォーマット

- **ktlint** または **Detekt** でスタイルを強制
- 公式 Kotlin コードスタイル（`gradle.properties` に `kotlin.code.style=official`）

## 不変性

- `var` よりも `val` を優先 — デフォルトは `val`、ミューテーションが必要な場合のみ `var` を使用
- 値型には `data class` を使用する; public API では不変コレクション（`List`、`Map`、`Set`）を使用
- 状態更新にはコピーオンライト: `state.copy(field = newValue)`

## 命名

Kotlin の慣例に従う:
- `camelCase` — 関数とプロパティ
- `PascalCase` — クラス、インターフェース、オブジェクト、型エイリアス
- `SCREAMING_SNAKE_CASE` — 定数（`const val` または `@JvmStatic`）
- インターフェースの接頭辞は振る舞いで付ける、`I` ではない: `Clickable` であって `IClickable` ではない

## Null 安全性

- `!!` は使用しない — `?.`、`?:`、`requireNotNull()`、または `checkNotNull()` を優先
- スコープ付き null 安全操作には `?.let {}` を使用
- 正当に結果がない可能性がある関数からは nullable 型を返す

```kotlin
// BAD
val name = user!!.name

// GOOD
val name = user?.name ?: "Unknown"
val name = requireNotNull(user) { "User must be set before accessing name" }.name
```

## シールド型

閉じた状態階層のモデリングにはシールドクラス/インターフェースを使用する:

```kotlin
sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Success<T>(val data: T) : UiState<T>
    data class Error(val message: String) : UiState<Nothing>
}
```

シールド型に対しては常に網羅的な `when` を使用する — `else` ブランチは使わない。

## 拡張関数

ユーティリティ操作には拡張関数を使用するが、発見しやすくする:
- レシーバー型にちなんだファイル名にする（`StringExt.kt`、`FlowExt.kt`）
- スコープを限定する — `Any` や過度に汎用的な型に拡張を追加しない

## スコープ関数

適切なスコープ関数を使用する:
- `let` — null チェック + 変換: `user?.let { greet(it) }`
- `run` — レシーバーを使って結果を計算: `service.run { fetch(config) }`
- `apply` — オブジェクトの設定: `builder.apply { timeout = 30 }`
- `also` — 副作用: `result.also { log(it) }`
- スコープ関数の深いネストは避ける（最大2レベル）

## エラーハンドリング

- `Result<T>` またはカスタムシールド型を使用
- throwable コードのラッピングには `runCatching {}` を使用
- `CancellationException` は絶対にキャッチしない — 常に再スローする
- 制御フローに `try-catch` を使用しない

```kotlin
// BAD — 制御フローに例外を使用
val user = try { repository.getUser(id) } catch (e: NotFoundException) { null }

// GOOD — nullable 戻り値
val user: User? = repository.findUser(id)
```
