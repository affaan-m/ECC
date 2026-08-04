---
description: hookifyシステムのヘルプを取得します
---

hookifyの包括的なドキュメントを表示します。

## フックシステムの概要

Hookifyは、望ましくない動作を防ぐために、Claude Codeのフックシステムと統合するルールファイルを作成します。

### イベントタイプ

- `bash`: Bashツール使用時にトリガーし、コマンドパターンにマッチ
- `file`: Write/Editツール使用時にトリガーし、ファイルパスにマッチ
- `stop`: セッション終了時にトリガー
- `prompt`: ユーザーメッセージ送信時にトリガーし、入力パターンにマッチ
- `all`: すべてのイベントでトリガー

### ルールファイル形式

ファイルは`.claude/hookify.{name}.local.md`として保存:

```yaml
---
name: descriptive-name
enabled: true
event: bash|file|stop|prompt|all
action: block|warn
pattern: "マッチする正規表現パターン"
---
ルールがトリガーされた時に表示されるメッセージ。
複数行をサポートします。
```

### コマンド

- `/hookify [説明]` 新しいルールを作成し、説明がない場合は会話を自動分析
- `/hookify-list` 設定済みルールを一覧表示
- `/hookify-configure` ルールのオン/オフを切り替え

### パターンのヒント

- 正規表現構文を使用
- `bash`の場合、完全なコマンド文字列に対してマッチ
- `file`の場合、ファイルパスに対してマッチ
- デプロイ前にパターンをテスト
