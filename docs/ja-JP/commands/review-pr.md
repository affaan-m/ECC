---
description: 特化エージェントを使用した包括的なPRレビュー
---

プルリクエストの包括的なマルチパースペクティブレビューを実行します。

## 使い方

`/review-pr [PR番号またはURL] [--focus=comments|tests|errors|types|code|simplify]`

PRが指定されていない場合、現在のブランチのPRをレビューします。focusが指定されていない場合、フルレビュースタックを実行します。

## ステップ

1. PRを特定:
   - `gh pr view`を使用してPRの詳細、変更ファイル、diffを取得
2. プロジェクトガイダンスを検索:
   - `CLAUDE.md`、リント設定、TypeScript設定、リポジトリ規約を探す
3. 特化レビューエージェントを実行:
   - `code-reviewer`
   - `comment-analyzer`
   - `pr-test-analyzer`
   - `silent-failure-hunter`
   - `type-design-analyzer`
   - `code-simplifier`
4. 結果を集約:
   - 重複する所見を排除
   - 重大度でランク付け
5. 重大度別にグループ化して所見を報告

## 信頼度ルール

信頼度80以上の問題のみ報告:

- Critical: バグ、セキュリティ、データ損失
- Important: テストの欠落、品質問題、スタイル違反
- Advisory: 明示的に要求された場合のみ提案
