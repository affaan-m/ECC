# ECCに貢献する

貢献いただきありがとうございます！このリポジトリはClaude Codeユーザーのためのコミュニティリソースです。

## 目次

- [探しているもの](#探しているもの)
- [クイックスタート](#クイックスタート)
- [スキルの貢献](#スキルの貢献)
- [エージェントの貢献](#エージェントの貢献)
- [フックの貢献](#フックの貢献)
- [コマンドの貢献](#コマンドの貢献)
- [プルリクエストプロセス](#プルリクエストプロセス)

---

## 探しているもの

### エージェント

特定のタスクをうまく処理できる新しいエージェント：
- 言語固有のレビュアー（Python、Go、Rust）
- フレームワークエキスパート（Django、Rails、Laravel、Spring）
- DevOpsスペシャリスト（Kubernetes、Terraform、CI/CD）
- ドメインエキスパート（MLパイプライン、データエンジニアリング、モバイル）

### スキル

ワークフロー定義とドメイン知識：
- 言語のベストプラクティス
- フレームワークのパターン
- テスト戦略
- アーキテクチャガイド

### フック

有用な自動化：
- リンティング/フォーマッティングフック
- セキュリティチェック
- バリデーションフック
- 通知フック

### コマンド

有用なワークフローを呼び出すスラッシュコマンド：
- デプロイコマンド
- テストコマンド
- コード生成コマンド

---

## クイックスタート

```bash
# 1. Fork とクローン
gh repo fork affaan-m/ECC --clone
cd ECC

# 2. ブランチを作成
git checkout -b feat/my-contribution

# 3. 貢献を追加（以下のセクション参照）

# 4. ローカルでテスト
cp -r skills/my-skill ~/.claude/skills/  # スキルの場合
# その後、Claude Codeでテスト

# 5. PR を送信
git add . && git commit -m "feat: add my-skill" && git push
```

---

## スキルの貢献

スキルは、コンテキストに基づいてClaude Codeが読み込む知識モジュールです。

### ディレクトリ構造

```
skills/
└── your-skill-name/
    └── SKILL.md
```

### SKILL.md テンプレート

```markdown
---
name: your-skill-name
description: スキルリストに表示される短い説明
---

# Your Skill Title

このスキルがカバーする内容の概要。

## Core Concepts

主要なパターンとガイドラインを説明します。

## Code Examples

\`\`\`typescript
// 実践的なテスト済みの例を含める
function example() {
  // よくコメントされたコード
}
\`\`\`

## Best Practices

- 実行可能なガイドライン
- すべき事とすべきでない事
- 回避すべき一般的な落とし穴

## When to Use

このスキルが適用されるシナリオを説明します。
```

### スキルチェックリスト

- [ ] 1つのドメイン/テクノロジーに焦点を当てている
- [ ] 実践的なコード例を含む
- [ ] 500行以下
- [ ] 明確なセクションヘッダーを使用
- [ ] Claude Codeでテスト済み

### サンプルスキル

| スキル | 目的 |
|-------|---------|
| `coding-standards/` | TypeScript/JavaScriptパターン |
| `frontend-patterns/` | ReactとNext.jsのベストプラクティス |
| `backend-patterns/` | APIとデータベースのパターン |
| `security-review/` | セキュリティチェックリスト |

---

## エージェントの貢献

エージェントはTaskツールで呼び出される特殊なアシスタントです。

### ファイルの場所

```
agents/your-agent-name.md
```

### エージェントテンプレート

```markdown
---
name: your-agent-name
description: このエージェントが実行する操作と、Claude が呼び出すべき時期。具体的に！
tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]
model: sonnet
---

あなたは[役割]スペシャリストです。

## Your Role

- 主な責任
- 副次的な責任
- あなたが実行しないこと（境界）

## Workflow

### Step 1: Understand
タスクへのアプローチ方法。

### Step 2: Execute
作業をどのように実行するか。

### Step 3: Verify
結果をどのように検証するか。

## Output Format

ユーザーに返すもの。

## Examples

### Example: [Scenario]
Input: [ユーザーが提供するもの]
Action: [実行する操作]
Output: [返すもの]
```

### エージェントフィールド

| フィールド | 説明 | オプション |
|-------|-------------|---------|
| `name` | 小文字、ハイフン区切り | `code-reviewer` |
| `description` | 呼び出すかどうかを判断するために使用 | 具体的に！ |
| `tools` | 必要なものだけ | `Read, Write, Edit, Bash, Grep, Glob, WebFetch, Task` |
| `model` | 複雑さレベル | `haiku`（シンプル）、`sonnet`（コーディング）、`opus`（複雑） |

### サンプルエージェント

| エージェント | 目的 |
|-------|---------|
| `tdd-guide.md` | テスト駆動開発 |
| `code-reviewer.md` | コードレビュー |
| `security-reviewer.md` | セキュリティスキャン |
| `build-error-resolver.md` | ビルドエラーの修正 |

---

## フックの貢献

フックはClaude Codeイベントによってトリガーされる自動的な動作です。

### ファイルの場所

```
hooks/hooks.json
```

### フックの種類

| 種類 | トリガー | ユースケース |
|------|---------|----------|
| `PreToolUse` | ツール実行前 | 検証、警告、ブロック |
| `PostToolUse` | ツール実行後 | フォーマット、チェック、通知 |
| `SessionStart` | セッション開始 | コンテキストの読み込み |
| `Stop` | セッション終了 | クリーンアップ、監査 |

### フックフォーマット

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "tool == \"Bash\" && tool_input.command matches \"rm -rf /\"",
        "hooks": [
          {
            "type": "command",
            "command": "echo '[Hook] BLOCKED: Dangerous command' && exit 1"
          }
        ],
        "description": "危険な rm コマンドをブロック"
      }
    ]
  }
}
```

### マッチャー構文

```javascript
// 特定のツールにマッチ
tool == "Bash"
tool == "Edit"
tool == "Write"

// 入力パターンにマッチ
tool_input.command matches "npm install"
tool_input.file_path matches "\\.tsx?$"

// 条件を組み合わせ
tool == "Bash" && tool_input.command matches "git push"
```

### フック例

```json
// tmux の外で開発サーバーをブロック
{
  "matcher": "tool == \"Bash\" && tool_input.command matches \"npm run dev\"",
  "hooks": [{"type": "command", "command": "echo 'Use tmux for dev servers' && exit 1"}],
  "description": "開発サーバーが tmux で実行されることを確認"
}

// TypeScript 編集後に自動フォーマット
{
  "matcher": "tool == \"Edit\" && tool_input.file_path matches \"\\.tsx?$\"",
  "hooks": [{"type": "command", "command": "npx prettier --write \"$file_path\""}],
  "description": "編集後に TypeScript ファイルをフォーマット"
}

// git push 前に警告
{
  "matcher": "tool == \"Bash\" && tool_input.command matches \"git push\"",
  "hooks": [{"type": "command", "command": "echo '[Hook] Review changes before pushing'"}],
  "description": "プッシュ前に変更をレビューするリマインダー"
}
```

### フックチェックリスト

- [ ] マッチャーが具体的（過度に広くない）
- [ ] 明確なエラー/情報メッセージを含む
- [ ] 正しい終了コードを使用（`exit 1`はブロック、`exit 0`は許可）
- [ ] 徹底的にテスト済み
- [ ] 説明を含む

---

## コマンドの貢献

コマンドは`/command-name`で呼び出されるユーザー起動アクションです。

### ファイルの場所

```
commands/your-command.md
```

### コマンドテンプレート

```markdown
---
description: /help に表示される短い説明
---

# Command Name

## Purpose

このコマンドが実行する操作。

## Usage

\`\`\`
/your-command [args]
\`\`\`

## Workflow

1. 最初のステップ
2. 2番目のステップ
3. 最終ステップ

## Output

ユーザーが受け取るもの。
```

### サンプルコマンド

| コマンド | 目的 |
|---------|---------|
| `commit.md` | gitコミットの作成 |
| `code-review.md` | コード変更のレビュー |
| `tdd.md` | TDDワークフロー |
| `e2e.md` | E2Eテスト |

---

## プルリクエストプロセス

### 1. PRタイトル形式

```
feat(skills): add rust-patterns skill
feat(agents): add api-designer agent
feat(hooks): add auto-format hook
fix(skills): update React patterns
docs: improve contributing guide
```

### 2. PR説明

```markdown
## Summary
何を追加しているのか、その理由。

## Type
- [ ] Skill
- [ ] Agent
- [ ] Hook
- [ ] Command

## Testing
これをどのようにテストしたか。

## Checklist
- [ ] フォーマットガイドに従う
- [ ] Claude Codeでテスト済み
- [ ] 機密情報なし（APIキー、パス）
- [ ] 明確な説明
```

### 3. レビュープロセス

1. メンテナーが48時間以内にレビュー
2. リクエストされた場合はフィードバックに対応
3. 承認後、mainにマージ

---

## ガイドライン

### すべきこと

- 貢献は焦点を絞って、モジュラーに保つ
- 明確な説明を含める
- 提出前にテストする
- 既存のパターンに従う
- 依存関係を文書化する

### すべきでないこと

- 機密データを含める（APIキー、トークン、パス）
- 過度に複雑またはニッチな設定を追加する
- テストされていない貢献を提出する
- 既存機能の重複を作成する

---

## ファイル命名規則

- 小文字とハイフンを使用：`python-reviewer.md`
- 説明的に：`workflow.md`ではなく`tdd-workflow.md`
- 名前をファイル名に一致させる

---

## 質問がありますか？

- **Issues:** [github.com/affaan-m/ECC/issues](https://github.com/affaan-m/ECC/issues)
- **X/Twitter:** [@affaanmustafa](https://x.com/affaanmustafa)

---

貢献いただきありがとうございます。一緒に素晴らしいリソースを構築しましょう。
