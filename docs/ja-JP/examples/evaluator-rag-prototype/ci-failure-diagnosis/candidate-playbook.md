# CI 失敗診断プレイブック

Candidate id: `log-backed-minimal-fix`

PR・メンテナーブランチ・リリース準備ブランチで、1つ以上の GitHub Actions チェックが失敗している場合に、このプレイブックを使用してください。

## 受け入れパス

1. PR およびブランチのコンテキストを取得する:
   - `gh pr view <pr-number> --json files,statusCheckRollup,headRefName,baseRefName`
   - `gh run view <run-id> --json jobs`
2. 失敗したログの証拠を取得する:
   - `gh run view <run-id> --log-failed`
3. 失敗したジョブ・ステップ・OS・Node/Python/Rust のバージョン・パッケージマネージャー、および最短で有用なエラーの抜粋を記録する。
4. 失敗したステップと PR の変更ファイルを比較する。
5. 既知の一致する障害モードを、現在のドキュメント・テスト・過去の PR から検索する。
6. ローカルでの再現コマンドまたはリグレッションコマンドを含む場合にのみ、最小限の修正パスを昇格させる。
7. 独立した実装ブランチが存在した後、絞り込まれたローカルゲートを再実行し、マージ前に GitHub Actions のフルマトリクスの完了を待つ。

## 拒否パス

元の失敗を記録せず、また無視しても安全な理由を明示せずに、一時的な成功結果が出るまで CI を繰り返し再実行してはならない。

チェックを通過させるためだけに、テストを弱体化させたり、マトリクスのレッグをスキップしたり、無関係なファイルにパッチを広げたりしてはならない。

必須チェックがまだ失敗している状態のブランチから、リリース準備完了を宣言してはならない。

## 最低限のバリデーション

- `gh run view <run-id> --log-failed`
- 失敗したサーフェスに対応する、絞り込まれたローカルコマンド（例）:
  - `node tests/<matching-test>.js`
  - `npm run harness:audit -- --format json`
  - `npm run observability:ready`
  - `cargo test`
- `git diff --check`
- マージ前に GitHub Actions の必須フルマトリクスの完了を確認

失敗したログの抜粋と選択したリグレッションコマンドを、修正をマージする前にメンテナーの PR 本文またはハンドオフに記録すること。
