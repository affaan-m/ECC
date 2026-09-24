---
paths:
  - "**/*.dart"
  - "**/pubspec.yaml"
  - "**/analysis_options.yaml"
---
# Dart/Flutter コーディングスタイル

> このファイルは [common/coding-style.md](../common/coding-style.md) を Dart および Flutter 固有のコンテンツで拡張します。

## フォーマット

- すべての `.dart` ファイルに **dart format** を使用 — CI で強制適用 (`dart format --set-exit-if-changed .`)
- 行の長さ: 80文字 (dart format のデフォルト)
- 差分とフォーマットを改善するため、複数行の引数/パラメータリストには末尾カンマを付ける

## イミュータビリティ

- ローカル変数には `final` を、コンパイル時定数には `const` を優先する
- すべてのフィールドが `final` の場合は `const` コンストラクタを使用する
- パブリック API からは変更不可コレクションを返す (`List.unmodifiable`、`Map.unmodifiable`)
- イミュータブルなステートクラスでのステート変更には `copyWith()` を使用する

```dart
// BAD
var count = 0;
List<String> items = ['a', 'b'];

// GOOD
final count = 0;
const items = ['a', 'b'];
```

## 命名規則

Dart の規約に従う:
- 変数、パラメータ、名前付きコンストラクタには `camelCase`
- クラス、列挙型、typedef、拡張機能には `PascalCase`
- ファイル名とライブラリ名には `snake_case`
- トップレベルで `const` 宣言された定数には `SCREAMING_SNAKE_CASE`
- プライベートメンバーには `_` プレフィックスを付ける
- 拡張機能名は拡張対象の型を表す: `MyHelpers` ではなく `StringExtensions`

## Null 安全性

- `!` (bang演算子) の使用を避ける — `?.`、`??`、`if (x != null)`、またはDart 3のパターンマッチングを優先する。`!` はnullがプログラムエラーを示し、クラッシュが適切な動作である場合にのみ使用する
- `late` の使用は初めて使用される前に初期化が保証されている場合のみに限定する（nullableまたはコンストラクタ初期化を優先する）
- 常に提供しなければならないコンストラクタパラメータには `required` を使用する

```dart
// BAD — user が null の場合、実行時にクラッシュする
final name = user!.name;

// GOOD — null対応演算子を使用
final name = user?.name ?? 'Unknown';

// GOOD — Dart 3 パターンマッチング (網羅的、コンパイラによるチェック)
final name = switch (user) {
  User(:final name) => name,
  null => 'Unknown',
};

// GOOD — 早期リターンによる null ガード
String getUserName(User? user) {
  if (user == null) return 'Unknown';
  return user.name; // ガードの後、非nullに昇格
}
```

## sealed 型とパターンマッチング (Dart 3+)

クローズドな状態階層をモデル化するには sealed クラスを使用する:

```dart
sealed class AsyncState<T> {
  const AsyncState();
}

final class Loading<T> extends AsyncState<T> {
  const Loading();
}

final class Success<T> extends AsyncState<T> {
  const Success(this.data);
  final T data;
}

final class Failure<T> extends AsyncState<T> {
  const Failure(this.error);
  final Object error;
}
```

sealed 型には常に網羅的な `switch` を使用する — default/ワイルドカードは使用しない:

```dart
// BAD
if (state is Loading) { ... }

// GOOD
return switch (state) {
  Loading() => const CircularProgressIndicator(),
  Success(:final data) => DataWidget(data),
  Failure(:final error) => ErrorWidget(error.toString()),
};
```

## エラーハンドリング

- `on` 節で例外の型を指定する — 裸の `catch (e)` は絶対に使用しない
- `Error` サブタイプは絶対にキャッチしない — それらはプログラムのバグを示す
- 回復可能なエラーには `Result` スタイルの型またはsealed クラスを使用する
- 制御フローに例外を使用しない

```dart
// BAD
try {
  await fetchUser();
} catch (e) {
  log(e.toString());
}

// GOOD
try {
  await fetchUser();
} on NetworkException catch (e) {
  log('Network error: ${e.message}');
} on NotFoundException {
  handleNotFound();
}
```

## 非同期 / Future

- 常に Future を `await` するか、意図的なfire-and-forgetを示すために明示的に `unawaited()` を呼び出す
- 何も `await` しない場合は関数を `async` とマークしない
- 並行操作には `Future.wait` / `Future.any` を使用する
- `await` の後に `BuildContext` を使用する前に `context.mounted` を確認する (Flutter 3.7+)

```dart
// BAD — Future を無視している
fetchData(); // 意図を示さずにfire-and-forget

// GOOD
unawaited(fetchData()); // 明示的なfire-and-forget
await fetchData();      // または適切に await する
```

## インポート

- 全体を通じて `package:` インポートを使用する — クロスフィーチャーまたはクロスレイヤーのコードに相対インポート (`../`) を使用しない
- 順序: `dart:` → 外部 `package:` → 内部 `package:` (同じパッケージ)
- 未使用のインポートは禁止 — `dart analyze` が `unused_import` で強制する

## コード生成

- 生成されたファイル (`.g.dart`、`.freezed.dart`、`.gr.dart`) はコミットするかgitignoreで一貫して除外する — プロジェクトごとに1つの戦略を選択する
- 生成されたファイルを手動で編集しない
- ジェネレータアノテーション (`@JsonSerializable`、`@freezed`、`@riverpod` 等) は正規のソースファイルのみに記述する
