---
paths:
  - "**/*.py"
  - "**/*.pyi"
---
# Python フック

> このファイルは [common/hooks.md](../common/hooks.md) を Python 固有のコンテンツで拡張します。

## PostToolUse フック

`~/.claude/settings.json` で設定:

- **black/ruff**: 編集後に `.py` ファイルを自動フォーマット
- **mypy/pyright**: `.py` ファイル編集後に型チェックを実行

## 警告

- 編集されたファイル内の `print()` 文について警告する（代わりに `logging` モジュールを使用）
