# ディープアナライザー証拠プレイブック

Candidate id: `corpus-backed-analyzer-change`

PR がリポジトリ分析・コミット分析・アーキテクチャ分類・ワークフロー検出・パターン検出・ディープ分析のリスク分類の動作を変更する場合に、このプレイブックを使用してください。

## 受け入れパス

1. 変更したアナライザーのサーフェスとソースファイルを明記する。
2. `../ECC-Tools/README.md` からディープアナライザー証拠のコントラクトを取得し、`../ECC-Tools/src/lib/analyzer.ts` のフォローアップロジックを確認する。
3. 変更内容を、維持されているコーパスまたは参照証拠と照合する:
   - `../ECC-Tools/src/analyzers/fixtures/deep-analyzer-corpus.ts`
   - `../ECC-Tools/src/analyzers/deep-analyzer-corpus.test.ts`
   - `../ECC-Tools/src/lib/analyzer.compare.test.ts`
4. 影響を受ける動作の期待される出力を比較する:
   - フォルダーの種類
   - モジュール構成
   - テストの配置場所
   - 主要言語
   - コミットメッセージの種類
   - 検出されたワークフロー名
5. 同じ変更サーフェスに対して、アナライザーのコーパス・期待出力スナップショット・フィクスチャ・ベンチマーク・ゴールデンケース・評価・参照セットを追加または更新する。
6. `../ECC-Tools/` から関連するバリデーションゲートを実行する:
   - `npm test -- src/analyzers/deep-analyzer-corpus.test.ts src/lib/analyzer.compare.test.ts`
   - `npm run typecheck`
   - `npm run lint`
7. コーパスケース・期待出力の比較・バリデーション出力・ロールバックノートをメンテナーの PR 本文またはハンドオフに記録する。

## 拒否パス

コーパス・スナップショット・フィクスチャ・ベンチマーク・ゴールデンケース・評価・参照セットの証拠なしに、アナライザーのしきい値・分類・リスク分類の変更を昇格させてはならない。

変更が小さいからといって `Deep Analyzer Evidence` の PR リスクバケットを抑制してはならない。同じアナライザーサーフェスをカバーする証拠が共存している場合にのみ抑制する。

広範な手動レビューのメモだけに依存してはならない。アナライザーの変更には、期待される出力を伴う代表的なリポジトリの形状またはコミット履歴のケースが必要である。

エバリュエーター実行から PR コメントの投稿・チェックランの作成・Linear の同期・パッケージの公開・プラグインの編集・リリースアーティファクトの作成を行ってはならない。

## 最低限のバリデーション

- `npm test -- src/analyzers/deep-analyzer-corpus.test.ts src/lib/analyzer.compare.test.ts`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- ドキュメントまたはプレイブックを変更した場合は Markdown lint

アナライザーの証拠のソース帰属を保持し、将来のメンテナー PR 向けにロールバックのガイダンスを含めること。
