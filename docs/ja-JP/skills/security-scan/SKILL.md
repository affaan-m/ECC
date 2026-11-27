---
name: security-scan
description: AgentShield を使用して、Claude Code の設定（.claude/ ディレクトリ）のセキュリティ脆弱性、設定ミス、インジェクションリスクをスキャンします。CLAUDE.md、settings.json、MCP サーバー、フック、エージェント定義をチェックします。
---

# Security Scan Skill

[AgentShield](https://github.com/affaan-m/agentshield) を使用して、Claude Code の設定のセキュリティ問題を監査します。

## 起動タイミング

- 新しい Claude Code プロジェクトのセットアップ時
- `.claude/settings.json`、`CLAUDE.md`、または MCP 設定の変更後
- 設定変更をコミットする前
- 既存の Claude Code 設定を持つ新しいリポジトリにオンボーディングする際
- 定期的なセキュリティ衛生チェック

## スキャン対象

| ファイル | チェック内容 |
|------|--------|
| `CLAUDE.md` | ハードコードされたシークレット、自動実行命令、プロンプトインジェクションパターン |
| `settings.json` | 過度に寛容な許可リスト、欠落した拒否リスト、危険なバイパスフラグ |
| `mcp.json` | リスクのある MCP サーバー、ハードコードされた環境シークレット、npx サプライチェーンリスク |
| `hooks/` | 補間によるコマンドインジェクション、データ流出、サイレントエラー抑制 |
| `agents/*.md` | 無制限のツールアクセス、プロンプトインジェクション表面、欠落したモデル仕様 |

## 前提条件

AgentShield がインストールされている必要があります。確認し、必要に応じてインストールします：

```bash
# インストール済みか確認
npx ecc-agentshield --version

# グローバルにインストール（推奨）
npm install -g ecc-agentshield

# または npx 経由で直接実行（インストール不要）
npx ecc-agentshield scan .
```

## 使用方法

### 基本スキャン

現在のプロジェクトの `.claude/` ディレクトリに対して実行します：

```bash
# 現在のプロジェクトをスキャン
npx ecc-agentshield scan

# 特定のパスをスキャン
npx ecc-agentshield scan --path /path/to/.claude

# 最小深刻度フィルタでスキャン
npx ecc-agentshield scan --min-severity medium
```

### 出力フォーマット

```bash
# ターミナル出力（デフォルト） — グレード付きのカラーレポート
npx ecc-agentshield scan

# JSON — CI/CD 統合用
npx ecc-agentshield scan --format json

# Markdown — ドキュメント用
npx ecc-agentshield scan --format markdown

# HTML — 自己完結型のダークテーマレポート
npx ecc-agentshield scan --format html > security-report.html
```

### 自動修正

安全な修正を自動的に適用します（自動修正可能とマークされた修正のみ）：

```bash
npx ecc-agentshield scan --fix
```

これにより以下が実行されます：
- ハードコードされたシークレットを環境変数参照に置き換え
- ワイルドカード権限をスコープ付き代替に厳格化
- 手動のみの提案は変更しない

### Opus 4.6 ディープ分析

より深い分析のために敵対的な3エージェントパイプラインを実行します：

```bash
# ANTHROPIC_API_KEY が必要
export ANTHROPIC_API_KEY=your-key
npx ecc-agentshield scan --opus --stream
```

これにより以下が実行されます：
1. **攻撃者（レッドチーム）** — 攻撃ベクトルを発見
2. **防御者（ブルーチーム）** — 強化を推奨
3. **監査人（最終判定）** — 両方の観点を統合

### 安全な設定の初期化

新しい安全な `.claude/` 設定をゼロから構築します：

```bash
npx ecc-agentshield init
```

作成されるもの：
- スコープ付き権限と拒否リストを持つ `settings.json`
- セキュリティベストプラクティスを含む `CLAUDE.md`
- `mcp.json` プレースホルダー

### GitHub Action

CI パイプラインに追加します：

```yaml
- uses: affaan-m/agentshield@v1
  with:
    path: '.'
    min-severity: 'medium'
    fail-on-findings: true
```

## 深刻度レベル

| グレード | スコア | 意味 |
|-------|-------|---------|
| A | 90-100 | 安全な設定 |
| B | 75-89 | 軽微な問題 |
| C | 60-74 | 注意が必要 |
| D | 40-59 | 重大なリスク |
| F | 0-39 | クリティカルな脆弱性 |

## 結果の解釈

### クリティカルな発見（即座に修正）
- 設定ファイル内のハードコードされた API キーまたはトークン
- 許可リスト内の `Bash(*)`（無制限のシェルアクセス）
- `${file}` 補間によるフック内のコマンドインジェクション
- シェルを実行する MCP サーバー

### 高い発見（本番前に修正）
- CLAUDE.md 内の自動実行命令（プロンプトインジェクションベクトル）
- 権限内の欠落した拒否リスト
- 不要な Bash アクセスを持つエージェント

### 中程度の発見（推奨）
- フック内のサイレントエラー抑制（`2>/dev/null`、`|| true`）
- 欠落した PreToolUse セキュリティフック
- MCP サーバー設定内の `npx -y` 自動インストール

### 情報の発見（認識）
- MCP サーバーの欠落した説明
- 正しくフラグ付けされた禁止命令（グッドプラクティス）

## リンク

- **GitHub**: [github.com/affaan-m/agentshield](https://github.com/affaan-m/agentshield)
- **npm**: [npmjs.com/package/ecc-agentshield](https://www.npmjs.com/package/ecc-agentshield)
