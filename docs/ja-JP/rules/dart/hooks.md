---
paths:
  - "**/*.dart"
  - "**/pubspec.yaml"
  - "**/analysis_options.yaml"
---
# Dart/Flutter フック

> このファイルは [common/hooks.md](../common/hooks.md) を Dart および Flutter 固有のコンテンツで拡張します。

## PostToolUse フック

`~/.claude/settings.json` で設定する:

- **dart format**: 編集後に `.dart` ファイルを自動フォーマット
- **dart analyze**: Dart ファイルの編集後に静的解析を実行し、警告を表示
- **flutter test**: 大きな変更後に影響を受けるテストをオプションで実行

## 推奨フック設定

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": { "tool_name": "Edit", "file_paths": ["**/*.dart"] },
        "hooks": [
          { "type": "command", "command": "dart format $CLAUDE_FILE_PATHS" }
        ]
      }
    ]
  }
}
```

## コミット前チェック

Dart/Flutter の変更をコミットする前に実行する:

```bash
dart format --set-exit-if-changed .
dart analyze --fatal-infos
flutter test
```

## 便利なワンライナー

```bash
# すべての Dart ファイルをフォーマット
dart format .

# 解析して問題を報告
dart analyze

# カバレッジ付きですべてのテストを実行
flutter test --coverage

# コード生成ファイルを再生成
dart run build_runner build --delete-conflicting-outputs

# 古くなったパッケージを確認
flutter pub outdated

# 制約の範囲内でパッケージをアップグレード
flutter pub upgrade
```
