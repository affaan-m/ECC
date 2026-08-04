---
description: 実装タスクに対して、制限付きイテレーションとスコアリングによるジェネレーター/エバリュエータービルドループを実行します。
---

$ARGUMENTSから以下を解析:
1. `brief` — 何をビルドするかのユーザーの一行説明
2. `--max-iterations N` — （オプション、デフォルト15）ジェネレーター-エバリュエーターサイクルの最大回数
3. `--pass-threshold N` — （オプション、デフォルト7.0）合格するための重み付きスコア
4. `--skip-planner` — （オプション）プランナーをスキップし、spec.mdが既に存在すると想定
5. `--eval-mode MODE` — （オプション、デフォルト"playwright"）次のいずれか: playwright, screenshot, code-only

## GANスタイルハーネスビルド

このコマンドは、Anthropicの2026年3月のハーネス設計論文に触発された3エージェントビルドループをオーケストレーションします。

### フェーズ 0: セットアップ
1. プロジェクトルートに`gan-harness/`ディレクトリを作成
2. サブディレクトリを作成: `gan-harness/feedback/`、`gan-harness/screenshots/`
3. gitが未初期化なら初期化
4. 開始時刻と設定をログ

### フェーズ 1: プランニング（プランナーエージェント）
`--skip-planner`が設定されていない場合:
1. ユーザーのブリーフでTaskツール経由で`gan-planner`エージェントを起動
2. `gan-harness/spec.md`と`gan-harness/eval-rubric.md`の生成を待機
3. 仕様のサマリーをユーザーに表示
4. フェーズ 2に進む

### フェーズ 2: ジェネレーター-エバリュエーターループ
```
iteration = 1
while iteration <= max_iterations:

    # 生成
    Taskツール経由でgan-generatorエージェントを起動:
    - spec.mdを読む
    - iteration > 1の場合: feedback/feedback-{iteration-1}.mdを読む
    - アプリケーションをビルド/改善
    - devサーバーが実行中であることを確認
    - 変更をコミット

    # ジェネレーターの完了を待機

    # 評価
    Taskツール経由でgan-evaluatorエージェントを起動:
    - eval-rubric.mdとspec.mdを読む
    - ライブアプリケーションをテスト（モード: playwright/screenshot/code-only）
    - ルーブリックに対してスコアリング
    - feedback/feedback-{iteration}.mdにフィードバックを書き込み

    # エバリュエーターの完了を待機

    # スコアチェック
    feedback/feedback-{iteration}.mdを読む
    重み付き合計スコアを抽出

    if score >= pass_threshold:
        "イテレーション {iteration} でスコア {score} で合格" をログ
        中断

    if iteration >= 3 and 直近2イテレーションでスコアが改善していない:
        "プラトー検出 — 早期停止" をログ
        中断

    iteration += 1
```

### フェーズ 3: サマリー
1. すべてのフィードバックファイルを読む
2. 最終スコアとイテレーション履歴を表示
3. スコア推移を表示: `iteration 1: 4.2 → iteration 2: 5.8 → ... → iteration N: 7.5`
4. 最終評価からの残りの問題を一覧
5. 合計時間と推定コストを報告

### 出力

```markdown
## GANハーネスビルドレポート

**ブリーフ:** [元のプロンプト]
**結果:** PASS/FAIL
**イテレーション:** N / max
**最終スコア:** X.X / 10

### スコア推移
| Iter | Design | Originality | Craft | Functionality | Total |
|------|--------|-------------|-------|---------------|-------|
| 1 | ... | ... | ... | ... | X.X |
| 2 | ... | ... | ... | ... | X.X |
| N | ... | ... | ... | ... | X.X |

### 残りの問題
- [最終評価からの問題]

### 作成されたファイル
- gan-harness/spec.md
- gan-harness/eval-rubric.md
- gan-harness/feedback/feedback-001.md ～ feedback-NNN.md
- gan-harness/generator-state.md
- gan-harness/build-report.md
```

完全なレポートを`gan-harness/build-report.md`に書き込みます。
