# GAN スタイルのハーネス例

さまざまなプロジェクトタイプに対してジェネレーター・エバリュエーター ハーネスを使用する方法を示す例。

## クイックスタート

```bash
# フルスタック Web アプリ (3つのエージェントをすべて使用)
./scripts/gan-harness.sh "Build a project management app with Kanban boards and team collaboration"

# フロントエンドデザイン (プランナーをスキップし、デザインの反復に集中)
GAN_SKIP_PLANNER=true ./scripts/gan-harness.sh "Create a stunning landing page for a crypto portfolio tracker"

# API のみ (ブラウザーテスト不要)
GAN_EVAL_MODE=code-only ./scripts/gan-harness.sh "Build a REST API for a recipe sharing platform with search and ratings"

# 予算を抑える (反復回数を減らし、しきい値を下げる)
GAN_MAX_ITERATIONS=5 GAN_PASS_THRESHOLD=6.5 ./scripts/gan-harness.sh "Build a todo app with categories and due dates"
```

## 例: コマンドを使用する

```bash
# Claude Code インタラクティブモードで:
/project:gan-build "Build a music streaming dashboard with playlists, visualizer, and social features"

# オプションを指定する場合:
/project:gan-build "Build a recipe sharing platform" --max-iterations 10 --pass-threshold 7.5 --eval-mode screenshot
```

## 例: 手動での3エージェント実行

最大限の制御が必要な場合は、各エージェントを個別に実行する:

```bash
# Step 1: プラン (spec.md を生成)
claude -p --model opus "$(cat agents/gan-planner.md)

Your brief: 'Build a retro game maker with sprite editor and level designer'

Write the full spec to gan-harness/spec.md and eval rubric to gan-harness/eval-rubric.md."

# Step 2: 生成 (反復 1)
claude -p --model opus "$(cat agents/gan-generator.md)

Iteration 1. Read gan-harness/spec.md. Build the initial application.
Start dev server on port 3000. Commit as iteration-001."

# Step 3: 評価 (反復 1)
claude -p --model opus "$(cat agents/gan-evaluator.md)

Iteration 1. Read gan-harness/eval-rubric.md.
Test http://localhost:3000. Write feedback to gan-harness/feedback/feedback-001.md.
Be ruthlessly strict."

# Step 4: 生成 (反復 2 — フィードバックを読み込む)
claude -p --model opus "$(cat agents/gan-generator.md)

Iteration 2. Read gan-harness/feedback/feedback-001.md FIRST.
Address every issue. Then read gan-harness/spec.md for remaining features.
Commit as iteration-002."

# 満足するまで Step 3〜4 を繰り返す
```

## 例: カスタム評価基準

非視覚的なプロジェクト（API・CLI・ライブラリ）の場合は、ルーブリックをカスタマイズする:

```bash
mkdir -p gan-harness
cat > gan-harness/eval-rubric.md << 'EOF'
# API Evaluation Rubric

### Correctness (weight: 0.4)
- Do all endpoints return expected data?
- Are edge cases handled (empty inputs, large payloads)?
- Do error responses have proper status codes?

### Performance (weight: 0.2)
- Response times under 100ms for simple queries?
- Database queries optimized (no N+1)?
- Pagination implemented for list endpoints?

### Security (weight: 0.2)
- Input validation on all endpoints?
- SQL injection prevention?
- Rate limiting implemented?
- Authentication properly enforced?

### Documentation (weight: 0.2)
- OpenAPI spec generated?
- All endpoints documented?
- Example requests/responses provided?
EOF

GAN_SKIP_PLANNER=true GAN_EVAL_MODE=code-only ./scripts/gan-harness.sh "Build a REST API for task management"
```

## プロジェクトタイプと推奨設定

| プロジェクトタイプ | 評価モード | 反復回数 | しきい値 | 概算コスト |
|-------------|-----------|------------|-----------|-----------|
| フルスタック Web アプリ | playwright | 10〜15 | 7.0 | $100〜200 |
| ランディングページ | screenshot | 5〜8 | 7.5 | $30〜60 |
| REST API | code-only | 5〜8 | 7.0 | $30〜60 |
| CLI ツール | code-only | 3〜5 | 6.5 | $15〜30 |
| データダッシュボード | playwright | 8〜12 | 7.0 | $60〜120 |
| ゲーム | playwright | 10〜15 | 7.0 | $100〜200 |

## 出力の確認

各実行の後、以下を確認する:

1. **`gan-harness/build-report.md`** — スコアの推移を含む最終サマリー
2. **`gan-harness/feedback/`** — すべての評価フィードバック（品質の進化を理解するのに有用）
3. **`gan-harness/spec.md`** — 完全な仕様（手動で作業を継続したい場合に有用）
4. **スコアの推移** — 着実な改善を示すはずである。停滞はモデルが上限に達したことを示す。

## ヒント

1. **明確なブリーフから始める** — 「Build X with Y and Z」は「make something cool」より効果的
2. **5回未満の反復は避ける** — 最初の2〜3回の反復は通常しきい値を下回る
3. **UI プロジェクトには `playwright` モードを使用する** — スクリーンショットのみではインタラクションのバグを見逃す
4. **フィードバックファイルをレビューする** — 最終スコアが合格していても、フィードバックには有益な洞察が含まれている
5. **仕様を反復改善する** — 結果が満足のいくものでない場合は `spec.md` を改善し、`--skip-planner` を付けて再実行する
