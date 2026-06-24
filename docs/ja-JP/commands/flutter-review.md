---
description: Flutter/Dartコードのイディオムパターン、ウィジェットのベストプラクティス、状態管理、パフォーマンス、アクセシビリティ、セキュリティをレビューします。flutter-reviewerエージェントを呼び出します。
---

# Flutterコードレビュー

このコマンドは**flutter-reviewer**エージェントを呼び出し、Flutter/Dartコードの変更をレビューします。

## このコマンドの動作

1. **コンテキストを収集**: `git diff --staged`と`git diff`をレビュー
2. **プロジェクトを調査**: `pubspec.yaml`、`analysis_options.yaml`、状態管理ソリューションを確認
3. **セキュリティ事前スキャン**: ハードコードされたシークレットと重大なセキュリティ問題を確認
4. **フルレビュー**: 完全なレビューチェックリストを適用
5. **所見を報告**: 重大度別にグループ化された問題を修正ガイダンス付きで出力

## 前提条件

`/flutter-review`を実行する前に、以下を確認してください:
1. **ビルドが通る** — まず`/flutter-build`を実行。壊れたコードのレビューは不完全です
2. **テストが通る** — `/flutter-test`を実行してリグレッションがないことを確認
3. **マージコンフリクトがない** — すべてのコンフリクトを解決し、diffが意図的な変更のみを反映するようにする
4. **`flutter analyze`がクリーン** — レビュー前にアナライザーの警告を修正

## 使用するタイミング

`/flutter-review`を使用するのは:
- Flutter/Dartの変更を含むPRを提出する前（ビルドとテストが通った後）
- 新機能を実装した後に問題を早期に発見するため
- 他の人のFlutterコードをレビューする時
- ウィジェット、状態管理コンポーネント、またはサービスクラスを監査する時
- プロダクションリリースの前

## レビュー領域

| 領域 | 重大度 |
|------|--------|
| ハードコードされたシークレット、平文HTTP | CRITICAL |
| アーキテクチャ違反、状態管理アンチパターン | CRITICAL |
| ウィジェットの再ビルド問題、リソースリーク | HIGH |
| `dispose()`の欠落、await後の`BuildContext` | HIGH |
| Dartのnullセーフティ、エラー/ローディング状態の欠落 | HIGH |
| Const伝搬、ウィジェットのコンポジション | HIGH |
| パフォーマンス: `build()`内の高コストな処理 | HIGH |
| アクセシビリティ、セマンティックラベル | MEDIUM |
| 状態遷移のテスト欠落 | HIGH |
| ハードコードされた文字列（l10n） | MEDIUM |
| Pub依存関係の衛生管理 | LOW |

## セッション例

````text
User: /flutter-review

Agent:
# Flutterコードレビュー

## コンテキスト

変更されたファイル:
- lib/features/auth/presentation/login_page.dart
- lib/features/auth/data/auth_repository_impl.dart

状態管理: Riverpod（pubspec.yamlから検出）
アーキテクチャ: feature-first

## セキュリティ事前スキャン

✓ ハードコードされたシークレットは検出されませんでした
✓ 平文HTTPコールはありません

## レビュー所見

[HIGH] 非同期ギャップ後にmountedチェックなしでBuildContextを使用
File: lib/features/auth/presentation/login_page.dart:67
Issue: `context.go('/home')`が`await auth.login(...)`の後に`mounted`チェックなしで呼び出されている。
Fix: await後のナビゲーション前に`if (!context.mounted) return;`を追加（Flutter 3.7+）。

[HIGH] AsyncValueのエラー状態が未処理
File: lib/features/auth/presentation/login_page.dart:42
Issue: `ref.watch(authProvider)`がloading/dataでswitchしているが、`error`ブランチがない。
Fix: switch式または`when()`コールにerrorケースを追加してユーザー向けエラーメッセージを表示。

[MEDIUM] ハードコードされた文字列がローカライズされていない
File: lib/features/auth/presentation/login_page.dart:89
Issue: `Text('Login')` — ユーザーに表示される文字列がローカライゼーションシステムを使用していない。
Fix: プロジェクトのl10nアクセサを使用: `Text(context.l10n.loginButton)`。

## レビューサマリー

| 重大度 | 件数 | ステータス |
|--------|------|-----------|
| CRITICAL | 0     | pass   |
| HIGH     | 2     | block  |
| MEDIUM   | 1     | info   |
| LOW      | 0     | note   |

判定: BLOCK — HIGH問題はマージ前に修正が必要です。
````

## 承認基準

- **承認**: CRITICALまたはHIGHの問題がない
- **ブロック**: CRITICALまたはHIGHの問題はマージ前に修正が必要

## 関連コマンド

- `/flutter-build` — まずビルドエラーを修正
- `/flutter-test` — レビュー前にテストを実行
- `/code-review` — 一般的なコードレビュー（言語非依存）

## 関連

- エージェント: `agents/flutter-reviewer.md`
- スキル: `skills/flutter-dart-code-review/`
- ルール: `rules/dart/`
