---
description: 厳密なバリデーションループを伴う実装計画の実行
argument-hint: <path/to/plan.md>
---

> PRPs-agentic-eng（Wirasm）から適応。PRP ワークフローシリーズの一部。

# PRP 実装

計画ファイルをステップごとに実行し、継続的にバリデーションを行います。すべての変更は即座に検証されます。壊れた状態を蓄積してはなりません。

**基本理念**: バリデーションループはミスを早期に検出します。変更のたびにチェックを実行します。問題は即座に修正します。

**黄金ルール**: バリデーションが失敗した場合、次に進む前に修正してください。壊れた状態を蓄積してはなりません。

---

## フェーズ 0 — 検出

### パッケージマネージャーの検出

| ファイルの存在 | パッケージマネージャー | ランナー |
|---|---|---|
| `bun.lockb` | bun | `bun run` |
| `pnpm-lock.yaml` | pnpm | `pnpm run` |
| `yarn.lock` | yarn | `yarn` |
| `package-lock.json` | npm | `npm run` |
| `pyproject.toml` または `requirements.txt` | uv / pip | `uv run` または `python -m` |
| `Cargo.toml` | cargo | `cargo` |
| `go.mod` | go | `go` |

### バリデーションスクリプト

`package.json`（または同等のファイル）で利用可能なスクリプトを確認します:

```bash
# Node.js プロジェクトの場合
cat package.json | grep -A 20 '"scripts"'
```

利用可能なコマンドを確認します: 型チェック、リント、テスト、ビルド。

---

## フェーズ 1 — 読み込み

計画ファイルを読み込みます:

```bash
cat "$ARGUMENTS"
```

計画から以下のセクションを抽出します:
- **概要** — 何を構築するか
- **ミラーするパターン** — 従うべきコード規約
- **変更対象ファイル** — 作成または変更するもの
- **ステップごとのタスク** — 実装の順序
- **バリデーションコマンド** — 正しさを検証する方法
- **受け入れ基準** — 完了の定義

ファイルが存在しないか、有効な計画でない場合:
```
Error: Plan file not found or invalid.
Run /prp-plan <feature-description> to create a plan first.
```

**チェックポイント**: 計画を読み込み完了。すべてのセクションを特定。タスクを抽出。

---

## フェーズ 2 — 準備

### Git の状態

```bash
git branch --show-current
git status --porcelain
```

### ブランチの判断

| 現在の状態 | アクション |
|---|---|
| フィーチャーブランチにいる | 現在のブランチを使用 |
| main にいて、ワーキングツリーがクリーン | フィーチャーブランチを作成: `git checkout -b feat/{plan-name}` |
| main にいて、ワーキングツリーがダーティ | **停止** — スタッシュまたはコミットを先に行うようユーザーに確認 |
| このフィーチャー用の Git ワークツリー内にいる | そのワークツリーを使用 |

### リモートとの同期

```bash
git pull --rebase origin $(git branch --show-current) 2>/dev/null || true
```

**チェックポイント**: 正しいブランチにいる。ワーキングツリー準備完了。リモート同期済み。

---

## フェーズ 3 — 実行

計画の各タスクを順番に処理します。

### タスクごとのループ

**ステップごとのタスク**の各タスクについて:

1. **MIRROR リファレンスを読む** — タスクの MIRROR フィールドで参照されているパターンファイルを開きます。コードを書く前に規約を理解します。

2. **実装する** — パターンに正確に従ってコードを書きます。GOTCHA 警告を適用します。指定された IMPORTS を使用します。

3. **即座にバリデーションする** — すべてのファイル変更後に:
   ```bash
   # 型チェックを実行（プロジェクトに応じてコマンドを調整）
   [type-check command from Phase 0]
   ```
   型チェックが失敗した場合 → 次のファイルに進む前にエラーを修正します。

4. **進捗を追跡する** — ログ: `[done] Task N: [task name] — complete`

### 逸脱の処理

実装が計画から逸脱する必要がある場合:
- **何が**変わったかを記録
- **なぜ**変わったかを記録
- 修正されたアプローチで続行
- これらの逸脱はレポートに記録されます

**チェックポイント**: すべてのタスクを実行完了。逸脱を記録済み。

---

## フェーズ 4 — バリデーション

計画のすべてのバリデーションレベルを実行します。各レベルで問題を修正してから次に進みます。

### レベル 1: 静的解析

```bash
# 型チェック — エラーゼロが必須
[project type-check command]

# リント — 可能な場合は自動修正
[project lint command]
[project lint-fix command]
```

自動修正後もリントエラーが残る場合は、手動で修正します。

### レベル 2: ユニットテスト

すべての新しい関数にテストを書きます（計画のテスト戦略で指定されたとおり）。

```bash
[project test command for affected area]
```

- すべての関数に少なくとも1つのテストが必要
- 計画に記載されたエッジケースをカバー
- テストが失敗した場合 → 実装を修正します（テストが間違っている場合を除き、テストではなく実装を修正）

### レベル 3: ビルドチェック

```bash
[project build command]
```

ビルドはエラーゼロで成功する必要があります。

### レベル 4: 統合テスト（該当する場合）

```bash
# サーバーを起動し、テストを実行し、サーバーを停止
[project dev server command] &
SERVER_PID=$!

# サーバーの準備完了を待機（ポートは必要に応じて調整）
SERVER_READY=0
for i in $(seq 1 30); do
  if curl -sf http://localhost:PORT/health >/dev/null 2>&1; then
    SERVER_READY=1
    break
  fi
  sleep 1
done

if [ "$SERVER_READY" -ne 1 ]; then
  kill "$SERVER_PID" 2>/dev/null || true
  echo "ERROR: Server failed to start within 30s" >&2
  exit 1
fi

[integration test command]
TEST_EXIT=$?

kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true

exit "$TEST_EXIT"
```

### レベル 5: エッジケーステスト

計画のテスト戦略チェックリストからエッジケースを実行します。

**チェックポイント**: 5つのバリデーションレベルすべてが合格。エラーゼロ。

---

## フェーズ 5 — レポート

### 実装レポートの作成

```bash
mkdir -p .claude/PRPs/reports
```

レポートを `.claude/PRPs/reports/{plan-name}-report.md` に書き込みます:

```markdown
# Implementation Report: [Feature Name]

## Summary
[何を実装したか]

## Assessment vs Reality

| 指標 | 予測（計画） | 実績 |
|---|---|---|
| 複雑度 | [計画から] | [実績] |
| 信頼度 | [計画から] | [実績] |
| 変更ファイル数 | [計画から] | [実際の数] |

## Tasks Completed

| # | タスク | ステータス | 備考 |
|---|---|---|---|
| 1 | [task name] | [done] Complete | |
| 2 | [task name] | [done] Complete | Deviated — [理由] |

## Validation Results

| レベル | ステータス | 備考 |
|---|---|---|
| 静的解析 | [done] Pass | |
| ユニットテスト | [done] Pass | N件のテストを作成 |
| ビルド | [done] Pass | |
| 統合 | [done] Pass | または N/A |
| エッジケース | [done] Pass | |

## Files Changed

| ファイル | アクション | 行数 |
|---|---|---|
| `path/to/file` | CREATED | +N |
| `path/to/file` | UPDATED | +N / -M |

## Deviations from Plan
[逸脱の一覧（何が、なぜ）、または「なし」]

## Issues Encountered
[発生した問題とその解決方法の一覧、または「なし」]

## Tests Written

| テストファイル | テスト数 | カバレッジ |
|---|---|---|
| `path/to/test` | N件のテスト | [カバーした領域] |

## Next Steps
- [ ] `/code-review` でコードレビュー
- [ ] `/prp-pr` でPRを作成
```

### PRD の更新（該当する場合）

この実装が PRD フェーズの一部だった場合:
1. フェーズのステータスを `in-progress` から `complete` に更新
2. レポートパスを参照として追加

### 計画のアーカイブ

```bash
mkdir -p .claude/PRPs/plans/completed
mv "$ARGUMENTS" .claude/PRPs/plans/completed/
```

**チェックポイント**: レポート作成完了。PRD 更新完了。計画をアーカイブ済み。

---

## フェーズ 6 — 出力

ユーザーに報告します:

```
## 実装完了

- **計画**: [plan file path] → completed/ にアーカイブ
- **ブランチ**: [current branch name]
- **ステータス**: [done] すべてのタスク完了

### バリデーション概要

| チェック | ステータス |
|---|---|
| 型チェック | [done] |
| リント | [done] |
| テスト | [done] (N件作成) |
| ビルド | [done] |
| 統合 | [done] または N/A |

### 変更されたファイル
- [N] ファイル作成、[M] ファイル更新

### 逸脱
[概要 または「なし — 計画どおりに実装」]

### 成果物
- レポート: `.claude/PRPs/reports/{name}-report.md`
- アーカイブ済み計画: `.claude/PRPs/plans/completed/{name}.plan.md`

### PRD 進捗（該当する場合）
| フェーズ | ステータス |
|---|---|
| フェーズ 1 | [done] 完了 |
| フェーズ 2 | [next] |
| ... | ... |

> 次のステップ: `/prp-pr` でプルリクエストを作成するか、`/code-review` で先に変更をレビューしてください。
```

---

## 失敗時の対処

### 型チェックの失敗
1. エラーメッセージを注意深く読む
2. ソースファイルの型エラーを修正
3. 型チェックを再実行
4. クリーンになってから次に進む

### テストの失敗
1. バグが実装にあるのかテストにあるのかを特定
2. 根本原因を修正（通常は実装側）
3. テストを再実行
4. グリーンになってから次に進む

### リントの失敗
1. まず自動修正を実行
2. エラーが残る場合は手動で修正
3. リントを再実行
4. クリーンになってから次に進む

### ビルドの失敗
1. 通常は型またはインポートの問題 — エラーメッセージを確認
2. 問題のあるファイルを修正
3. ビルドを再実行
4. 成功してから次に進む

### 統合テストの失敗
1. サーバーが正しく起動したか確認
2. エンドポイント/ルートが存在するか確認
3. リクエスト形式が期待どおりか確認
4. 修正して再実行

---

## 成功基準

- **TASKS_COMPLETE**: 計画のすべてのタスクを実行
- **TYPES_PASS**: 型エラーゼロ
- **LINT_PASS**: リントエラーゼロ
- **TESTS_PASS**: すべてのテストがグリーン、新しいテストを作成
- **BUILD_PASS**: ビルド成功
- **REPORT_CREATED**: 実装レポートを保存
- **PLAN_ARCHIVED**: 計画を `completed/` に移動

---

## 次のステップ

- `/code-review` を実行してコミット前に変更をレビュー
- `/prp-commit` を実行して説明的なメッセージでコミット
- `/prp-pr` を実行してプルリクエストを作成
- `/prp-plan <next-phase>` を実行（PRD にさらにフェーズがある場合）
