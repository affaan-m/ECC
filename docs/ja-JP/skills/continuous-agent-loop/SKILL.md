---
name: continuous-agent-loop
description: 品質ゲート、評価、リカバリーコントロールを備えた継続的な自律エージェントループのパターン。
origin: ECC
---

# 継続的エージェントループ

これはv1.8+の標準ループスキル名です。1リリースの間、`autonomous-loops`との互換性を保ちながら置き換えます。

## ループ選択フロー

```text
Start
  |
  +-- Need strict CI/PR control? -- yes --> continuous-pr
  |
  +-- Need RFC decomposition? -- yes --> rfc-dag
  |
  +-- Need exploratory parallel generation? -- yes --> infinite
  |
  +-- default --> sequential
```

## 組み合わせパターン

推奨される本番スタック：
1. RFC分解（`ralphinho-rfc-pipeline`）
2. 品質ゲート（`plankton-code-quality` + `/quality-gate`）
3. 評価ループ（`eval-harness`）
4. セッション永続化（`nanoclaw-repl`）

## 失敗モード

- 測定可能な進捗なしのループチャーン
- 同じ根本原因での繰り返しリトライ
- マージキューの停止
- 無制限のエスカレーションによるコストドリフト

## リカバリー

- ループを凍結する
- `/harness-audit`を実行する
- スコープを失敗ユニットに縮小する
- 明示的な受け入れ基準でリプレイする
