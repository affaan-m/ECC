---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# TypeScript/JavaScript フック

> このファイルは [common/hooks.md](../common/hooks.md) を TypeScript/JavaScript 固有のコンテンツで拡張します。

## PostToolUse フック

`~/.claude/settings.json` で設定する:

- **Prettier**: JS/TS ファイルを編集後に自動フォーマットする
- **TypeScript チェック**: `.ts`/`.tsx` ファイルの編集後に `tsc` を実行する
- **console.log 警告**: 編集されたファイルの `console.log` について警告する

## Stop フック

- **console.log 監査**: セッション終了前にすべての変更されたファイルで `console.log` をチェックする
