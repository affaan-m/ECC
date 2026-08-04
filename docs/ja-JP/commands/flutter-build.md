---
description: Dartアナライザーエラーとflutterビルドの障害をインクリメンタルに修正します。最小限の外科的修正のためにdart-build-resolverエージェントを呼び出します。
---

# Flutterビルドと修正

このコマンドは**dart-build-resolver**エージェントを呼び出し、Dart/Flutterビルドエラーを最小限の変更でインクリメンタルに修正します。

## このコマンドの動作

1. **診断を実行**: `flutter analyze`、`flutter pub get`を実行
2. **エラーを解析**: ファイルごとにグループ化し、重大度でソート
3. **インクリメンタルに修正**: 一度に1つのエラー
4. **各修正を検証**: 各変更後に分析を再実行
5. **サマリーを報告**: 修正されたものと残りを表示

## 使用するタイミング

`/flutter-build`を使用するのは:
- `flutter analyze`がエラーを報告する場合
- いずれかのプラットフォームで`flutter build`が失敗する場合
- `dart pub get` / `flutter pub get`がバージョン競合で失敗する場合
- `build_runner`がコード生成に失敗する場合
- ビルドを壊す変更をプルした後

## 実行される診断コマンド

```bash
# 分析
flutter analyze 2>&1

# 依存関係
flutter pub get 2>&1

# コード生成（プロジェクトがbuild_runnerを使用する場合）
dart run build_runner build --delete-conflicting-outputs 2>&1

# プラットフォームビルド
flutter build apk 2>&1
flutter build web 2>&1
```

## 一般的に修正されるエラー

| エラー | 典型的な修正 |
|--------|------------|
| `A value of type 'X?' can't be assigned to 'X'` | `?? default`またはnullガードを追加 |
| `The name 'X' isn't defined` | importを追加またはタイプミスを修正 |
| `Non-nullable instance field must be initialized` | 初期化子または`late`を追加 |
| `Version solving failed` | pubspec.yamlのバージョン制約を調整 |
| `Missing concrete implementation of 'X'` | 欠落したインターフェースメソッドを実装 |
| `build_runner: Part of X expected` | 古い`.g.dart`を削除して再ビルド |

## 修正戦略

1. **分析エラーを最初に** — コードがエラーフリーでなければならない
2. **警告のトリアージを次に** — ランタイムバグを引き起こす可能性のある警告を修正
3. **pub競合を3番目に** — 依存関係の解決を修正
4. **一度に1つの修正** — 各変更を検証
5. **最小限の変更** — リファクタリングせず、修正のみ

## 停止条件

エージェントは以下の場合に停止して報告する:
- 3回の試行後も同じエラーが持続
- 修正がより多くのエラーを導入
- アーキテクチャ変更が必要
- パッケージアップグレード競合にユーザー判断が必要

## 関連コマンド

- `/flutter-test` — ビルド成功後にテストを実行
- `/flutter-review` — コード品質をレビュー
- `verification-loop`スキル — 完全な検証ループ

## 関連

- エージェント: `agents/dart-build-resolver.md`
- スキル: `skills/flutter-dart-code-review/`
