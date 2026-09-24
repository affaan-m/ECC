---
description: Flutter/Dartテストを実行し、失敗を報告し、テスト問題をインクリメンタルに修正します。ユニット、ウィジェット、ゴールデン、統合テストをカバーします。
---

# Flutterテスト

このコマンドはFlutterテストスイートを実行し、結果を報告します。失敗が発生した場合、問題を診断しインクリメンタルに修正します。

## このコマンドの動作

1. **テスト実行**: `flutter test`を実行（または変更されたファイルにスコープを限定）
2. **失敗を解析**: タイプと原因別に失敗するテストを特定
3. **インクリメンタルに修正**: 可能な場合は一度に1つの失敗
4. **検証**: 各修正後に再実行
5. **報告**: カバレッジサマリーと残りの失敗を表示

## 使用するタイミング

`/flutter-test`を使用するのは:
- 機能を実装した後に何も壊れていないことを確認するため
- `/flutter-build`実行後にテストが通ることを確認するため
- 新しいコードのテストカバレッジを確認するため
- 特定のテストファイルが失敗している時
- PRを提出する前

## 実行されるコマンド

```bash
# すべてのテストを実行
flutter test 2>&1

# カバレッジ付きで実行
flutter test --coverage 2>&1

# 特定のテストファイルを実行
flutter test test/unit/domain/usecases/get_user_test.dart 2>&1

# 名前パターンに一致するテストを実行
flutter test --name "CartBloc" 2>&1

# 統合テストを実行（デバイス/エミュレーターが必要）
flutter test integration_test/ 2>&1

# 意図的なビジュアル変更時にゴールデンファイルを更新
flutter test --update-goldens 2>&1
```

## セッション例

````text
User: /flutter-test

Agent:
# Flutterテスト実行

## テスト実行

```
$ flutter test
00:05 +42 -2: Some tests failed.

FAILED: test/unit/data/user_repository_test.dart
  UserRepository getById
    returns null when user not found
    Expected: null
    Actual: User(id: 'test-id', name: 'Test User')

FAILED: test/widget/cart_page_test.dart
  CartPage
    shows empty state when cart is empty
    Expected: exactly one widget with text 'Your cart is empty'
    Found: no widget with text 'Your cart is empty'
```

## 修正 1: リポジトリテスト

File: test/unit/data/user_repository_test.dart
失敗: `getById`が欠落IDに対してnullを返すべきところでユーザーを返す

根本原因: テストセットアップがID 'test-id' のユーザーを追加するが、'missing-id' でクエリしている。
修正: 'missing-id' でクエリするようテストを更新 — セットアップは正しく、クエリが間違っていた。

```
$ flutter test test/unit/data/user_repository_test.dart
1 test passed.
```

## 修正 2: ウィジェットテスト

File: test/widget/cart_page_test.dart
失敗: 空状態のテキストウィジェットが見つからない

根本原因: 空状態メッセージがウィジェット内で 'Your cart is empty' から 'Cart is empty' に変更されていた。
修正: 現在のウィジェットのコピーに合わせてテスト文字列を更新。

```
$ flutter test test/widget/cart_page_test.dart
1 test passed.
```

## 最終実行

```
$ flutter test --coverage
All 44 tests passed.
Coverage: 84.2% (target: 80%)
```

## サマリー

| メトリクス | 値 |
|-----------|-----|
| 総テスト数 | 44 |
| 成功 | 44 |
| 失敗 | 0 |
| カバレッジ | 84.2% |

テストステータス: PASS ✓
````

## 一般的なテスト失敗

| 失敗 | 典型的な修正 |
|------|-------------|
| `Expected: <X> Actual: <Y>` | アサーションを更新するか実装を修正 |
| `Widget not found` | ファインダーセレクタを修正するかウィジェット名変更後にテストを更新 |
| `Golden file not found` | `flutter test --update-goldens`を実行して生成 |
| `Golden mismatch` | 差分を検査し、変更が意図的なら`--update-goldens`を実行 |
| `MissingPluginException` | テストセットアップでプラットフォームチャネルをモック |
| `LateInitializationError` | `setUp()`で`late`フィールドを初期化 |
| `pumpAndSettle timed out` | 明示的な`pump(Duration)`コールに置き換え |

## 関連コマンド

- `/flutter-build` — テスト実行前にビルドエラーを修正
- `/flutter-review` — テスト通過後にコードをレビュー
- `tdd-workflow`スキル — テスト駆動開発ワークフロー

## 関連

- エージェント: `agents/flutter-reviewer.md`
- エージェント: `agents/dart-build-resolver.md`
- スキル: `skills/flutter-dart-code-review/`
- ルール: `rules/dart/testing.md`
