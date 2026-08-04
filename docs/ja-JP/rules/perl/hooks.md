---
paths:
  - "**/*.pl"
  - "**/*.pm"
  - "**/*.t"
  - "**/*.psgi"
  - "**/*.cgi"
---
# Perl フック

> このファイルは [common/hooks.md](../common/hooks.md) を Perl 固有のコンテンツで拡張します。

## PostToolUse フック

`~/.claude/settings.json` で設定:

- **perltidy**: 編集後に `.pl` と `.pm` ファイルを自動フォーマット
- **perlcritic**: `.pm` ファイル編集後にリントチェックを実行

## 警告

- スクリプト以外の `.pm` ファイルでの `print` について警告する — `say` またはロギングモジュール（例: `Log::Any`）を使用すること
