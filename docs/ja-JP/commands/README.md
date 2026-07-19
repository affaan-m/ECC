# コマンド

コマンドはスラッシュ（`/command-name`）で起動するユーザー起動アクションです。有用なワークフローと開発タスクを実行します。

## コマンドカテゴリ

### ビルド & エラー修正
- `/build-fix` - ビルドエラーを修正
- `/go-build` - Go ビルドエラーを解決
- `/go-test` - Go テストを実行

### コード品質
- `/code-review` - コード変更をレビュー
- `/python-review` - Python コードをレビュー
- `/go-review` - Go コードをレビュー

### テスト & 検証
- `/go-test`, `/kotlin-test`, `/rust-test`, `/cpp-test`, `/flutter-test`, `/react-test` - 言語別 TDD ワークフロー
- `/test-coverage` - テストカバレッジを確認
- （`/tdd` は廃止 → `tdd-workflow` スキルを使用）
- （`/e2e` は廃止 → `e2e-testing` スキルを使用）
- （`/verify` は廃止 → `verification-loop` スキルを使用）

### 計画 & 実装
- `/plan` - 機能実装計画を作成
- `/skill-create` - 新しいスキルを作成
- `/multi-*` - マルチプロジェクト ワークフロー

### ドキュメント
- `/update-docs` - ドキュメントを更新
- `/update-codemaps` - Codemap を更新

### 開発 & デプロイ
- `/checkpoint` - 実装チェックポイント
- `/evolve` - 機能を進化
- `/learn` - プロジェクトについて学ぶ
- （`/orchestrate` は廃止 → `dmux-workflows` / `autonomous-agent-harness` スキルを使用）
- `/pm2` - PM2 デプロイメント管理
- `/setup-pm` - PM2 を設定
- `/sessions` - セッション管理

### インスティンク機能
- `/instinct-import` - インスティンク をインポート
- `/instinct-export` - インスティンク をエクスポート
- `/instinct-status` - インスティンク ステータス

## コマンド実行

Claude Code でコマンドを実行：

```bash
/plan
/test-coverage
/code-review
/build-fix
```

または AI エージェントから：

```
ユーザー：「新しい機能を計画して」
Claude：実行 → `/plan` コマンド
```

## よく使うコマンド

### 開発ワークフロー
1. `/plan` - 実装計画を作成
2. `tdd-workflow` スキル - テストを書いて機能を実装
3. `/code-review` - コード品質をレビュー
4. `/build-fix` - ビルドエラーを修正
5. `e2e-testing` スキル - E2E テストを実行
6. `/update-docs` - ドキュメントを更新

### デバッグワークフロー
1. `verification-loop` スキル - 実装を検証
2. `/code-review` - 品質をチェック
3. `/build-fix` - エラーを修正
4. `/test-coverage` - カバレッジを確認

## カスタムコマンドを追加

カスタムコマンドを作成するには：

1. `commands/` に `.md` ファイルを作成
2. Frontmatter を追加：

```markdown
---
description: Brief description shown in /help
---

# Command Name

## Purpose

What this command does.

## Usage

\`\`\`
/command-name [args]
\`\`\`

## Workflow

1. Step 1
2. Step 2
3. Step 3
```

---

**覚えておいてください**：コマンドはワークフローを自動化し、繰り返しタスクを簡素化します。チームの一般的なパターンに対する新しいコマンドを作成することをお勧めします。
