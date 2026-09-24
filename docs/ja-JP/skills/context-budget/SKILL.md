---
name: context-budget
description: エージェント、スキル、MCPサーバー、ルールにわたってClaude Codeのコンテキストウィンドウ消費を監査します。肥大化、冗長なコンポーネントを特定し、優先順位付けされたトークン節約の推奨事項を生成します。
origin: ECC
---

# コンテキストバジェット

Claude Codeセッションで読み込まれたすべてのコンポーネントのトークンオーバーヘッドを分析し、コンテキストスペースを取り戻すための実用的な最適化を表示します。

## 使用時期

- セッションのパフォーマンスが低下しているか、出力品質が低下している場合
- 多くのスキル、エージェント、またはMCPサーバーを追加した後
- 実際に持っているコンテキストのヘッドルームを確認したい場合
- コンポーネントを追加する計画があり、スペースがあるか確認したい場合
- `/context-budget`コマンドを実行する場合（このスキルがそれをサポートします）

## 動作方法

### フェーズ1: インベントリ

すべてのコンポーネントディレクトリをスキャンしてトークン消費を推定します：

**エージェント** (`agents/*.md`)
- ファイルごとの行数とトークンをカウント（単語数 × 1.3）
- `description`フロントマターの長さを抽出
- フラグ: 200行超のファイル（重い）、30単語超のdescription（肥大化したフロントマター）

**スキル** (`skills/*/SKILL.md`)
- SKILL.mdごとのトークンをカウント
- フラグ: 400行超のファイル
- `.agents/skills/`の重複コピーを確認 — 二重カウントを避けるために同一コピーをスキップ

**ルール** (`rules/**/*.md`)
- ファイルごとのトークンをカウント
- フラグ: 100行超のファイル
- 同一言語モジュール内のルールファイル間のコンテンツの重複を検出

**MCPサーバー** (`.mcp.json`またはアクティブなMCP設定)
- 設定されたサーバー数と合計ツール数をカウント
- スキーマオーバーヘッドをツールあたり約500トークンと推定
- フラグ: 20以上のツールを持つサーバー、シンプルなCLIコマンド（`gh`、`git`、`npm`、`supabase`、`vercel`）をラップするサーバー

**CLAUDE.md** (プロジェクト + ユーザーレベル)
- CLAUDE.mdチェーンのファイルごとのトークンをカウント
- フラグ: 合計300行超

### フェーズ2: 分類

すべてのコンポーネントをバケットに分類します：

| バケット | 基準 | アクション |
|--------|----------|--------|
| **常に必要** | CLAUDE.mdで参照されている、アクティブなコマンドをサポート、または現在のプロジェクトタイプに一致 | 保持 |
| **時々必要** | ドメイン固有（例：言語パターン）、CLAUDE.mdで未参照 | オンデマンドアクティベーションを検討 |
| **めったに必要でない** | コマンド参照なし、コンテンツ重複、または明らかなプロジェクト一致なし | 削除または遅延ロード |

### フェーズ3: 問題の検出

以下の問題パターンを特定します：

- **肥大化したエージェントdescription** — フロントマターに30単語超のdescriptionはすべてのTaskツール呼び出しで読み込まれる
- **重いエージェント** — 200行超のファイルはすべてのスポーン時にTaskツールのコンテキストを膨らませる
- **冗長なコンポーネント** — エージェントロジックを複製するスキル、CLAUDE.mdを複製するルール
- **MCPの過剰サブスクリプション** — 10以上のサーバー、または無料で利用できるCLIツールをラップするサーバー
- **CLAUDE.mdの肥大化** — 冗長な説明、古いセクション、ルールであるべき指示

### フェーズ4: レポート

コンテキストバジェットレポートを生成します：

```
Context Budget Report
═══════════════════════════════════════

Total estimated overhead: ~XX,XXX tokens
Context model: Claude Sonnet (200K window)
Effective available context: ~XXX,XXX tokens (XX%)

Component Breakdown:
┌─────────────────┬────────┬───────────┐
│ Component       │ Count  │ Tokens    │
├─────────────────┼────────┼───────────┤
│ Agents          │ N      │ ~X,XXX    │
│ Skills          │ N      │ ~X,XXX    │
│ Rules           │ N      │ ~X,XXX    │
│ MCP tools       │ N      │ ~XX,XXX   │
│ CLAUDE.md       │ N      │ ~X,XXX    │
└─────────────────┴────────┴───────────┘

WARNING: Issues Found (N):
[ranked by token savings]

Top 3 Optimizations:
1. [action] → save ~X,XXX tokens
2. [action] → save ~X,XXX tokens
3. [action] → save ~X,XXX tokens

Potential savings: ~XX,XXX tokens (XX% of current overhead)
```

詳細モードでは、ファイルごとのトークン数、最も重いファイルの行ごとの内訳、重複するコンポーネント間の特定の冗長行、ツールごとのスキーマサイズ推定を含むMCPツールリストも出力します。

## 例

**基本監査**
```
User: /context-budget
Skill: Scans setup → 16 agents (12,400 tokens), 28 skills (6,200), 87 MCP tools (43,500), 2 CLAUDE.md (1,200)
       Flags: 3 heavy agents, 14 MCP servers (3 CLI-replaceable)
       Top saving: remove 3 MCP servers → -27,500 tokens (47% overhead reduction)
```

**詳細モード**
```
User: /context-budget --verbose
Skill: Full report + per-file breakdown showing planner.md (213 lines, 1,840 tokens),
       MCP tool list with per-tool sizes, duplicated rule lines side by side
```

**拡張前の確認**
```
User: I want to add 5 more MCP servers, do I have room?
Skill: Current overhead 33% → adding 5 servers (~50 tools) would add ~25,000 tokens → pushes to 45% overhead
       Recommendation: remove 2 CLI-replaceable servers first to stay under 40%
```

## ベストプラクティス

- **トークン推定**: 散文には`単語数 × 1.3`を、コードが多いファイルには`文字数 / 4`を使用
- **MCPが最大のレバー**: 各ツールスキーマはおよそ500トークンかかります。30ツールのサーバーはスキル全部よりも多くかかります
- **エージェントdescriptionは常に読み込まれる**: エージェントが呼び出されなくても、そのdescriptionフィールドはすべてのTaskツールのコンテキストに存在します
- **デバッグには詳細モード**: 特定のファイルがオーバーヘッドを駆動していることを正確に特定する必要がある場合に使用し、通常の監査には使用しない
- **変更後に監査**: エージェント、スキル、またはMCPサーバーを追加した後に実行して、クリープを早期にキャッチ
