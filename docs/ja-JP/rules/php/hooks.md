---
paths:
  - "**/*.php"
  - "**/composer.json"
  - "**/phpstan.neon"
  - "**/phpstan.neon.dist"
  - "**/psalm.xml"
---
# PHP フック

> このファイルは [common/hooks.md](../common/hooks.md) を PHP 固有のコンテンツで拡張します。

## PostToolUse フック

`~/.claude/settings.json` で設定:

- **Pint / PHP-CS-Fixer**: 編集された `.php` ファイルを自動フォーマット。
- **PHPStan / Psalm**: 型付きコードベースで PHP 編集後に静的解析を実行。
- **PHPUnit / Pest**: 編集が動作に影響する場合、対象ファイルやモジュールのテストを実行。

## 警告

- 編集されたファイルに残された `var_dump`、`dd`、`dump`、`die()` について警告する。
- 編集された PHP ファイルが生 SQL を追加したり CSRF/セッション保護を無効化している場合に警告する。
