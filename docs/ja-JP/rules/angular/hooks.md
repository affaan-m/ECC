---
paths:
  - "**/*.component.ts"
  - "**/*.component.html"
  - "**/*.service.ts"
  - "**/*.directive.ts"
  - "**/*.pipe.ts"
  - "**/*.spec.ts"
---
# Angular フック

> このファイルは [common/hooks.md](../common/hooks.md) を Angular 固有のコンテンツで拡張します。

## PostToolUse フック

`~/.claude/settings.json` で設定してください:

- **Prettier**: 編集後に `.ts` と `.html` ファイルを自動フォーマット
- **ESLint / ng lint**: Angular ソースファイルの編集後に `ng lint` を実行し、デコレータの誤用、テンプレートエラー、スタイル違反を検出
- **TypeScript チェック**: `.ts` ファイルの編集後に `tsc --noEmit` を実行
- **ビルドチェック**: Angular コードの生成または大幅な変更後に `ng build` を実行し、テンプレートと型エラーを早期に検出

## Stop フック

- **Lint 監査**: セッション終了前に変更されたファイル全体で `ng lint` を実行し、未解決の違反を検出
