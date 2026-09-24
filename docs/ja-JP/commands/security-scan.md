---
description: エージェント、フック、MCP、パーミッション、シークレットのサーフェスに対してAgentShieldを実行します。
agent: everything-claude-code:security-reviewer
subtask: true
---

# セキュリティスキャンコマンド

現在のプロジェクトまたはターゲットパスに対してAgentShieldを実行し、所見を優先順位付きの修正計画に変換します。

## 使い方

`/security-scan [path] [--format text|json|markdown|html] [--min-severity low|medium|high|critical] [--fix]`

- `path`（オプション）: デフォルトは現在のプロジェクト。`.claude/`パス、リポジトリルート、またはチェックインされたテンプレートディレクトリを使用。
- `--format`: 出力形式。CIには`json`、引き継ぎには`markdown`、スタンドアロンレビューレポートには`html`。
- `--min-severity`: 低優先度の所見をフィルタ。
- `--fix`: 安全かつ自動修正可能と明示的にマークされたAgentShieldの修正のみを適用。

## 決定論的エンジン

パッケージ化されたスキャナーを優先:

```bash
npx ecc-agentshield scan --path "${TARGET_PATH:-.}" --format text
```

ローカルAgentShield開発の場合、AgentShieldチェックアウトから実行:

```bash
npm run scan -- --path "${TARGET_PATH:-.}" --format text
```

所見を作り出さないこと。AgentShieldの出力を信頼できるソースとして使用し、スキャナーの事実とフォローアップの判断を分離。

## レビューチェックリスト

1. まずアクティブなランタイムの所見を特定:
   - ハードコードされたシークレット
   - 広範なパーミッション
   - 実行可能なフック
   - シェル、ファイルシステム、リモートトランスポート、またはピン留めされていない`npx`を持つMCPサーバー
   - 防御なしで信頼できないコンテンツを処理するエージェントプロンプト
2. 低信頼度のインベントリを分離:
   - ドキュメントの例
   - テンプレートの例
   - プラグインマニフェスト
   - プロジェクトローカルのオプション設定
3. criticalまたはhighの各所見について返却:
   - ファイルパス
   - 重大度
   - ランタイム信頼度
   - 重要な理由
   - 正確な修正方法
   - 自動修正が安全かどうか
4. `--fix`が要求された場合、修正を適用する前に計画された編集を述べる。
5. 修正後にスキャンを再実行し、前後のスコアを報告。

## 出力契約

返却内容:

1. セキュリティグレードとスコア。
2. 重大度とランタイム信頼度別の件数。
3. 正確なパス付きのcritical/highの所見。
4. 低信頼度の所見は別グループ。
5. 修正順序。
6. 実行されたコマンドとスキャンがローカル、CI、npxバックのいずれか。

## CIパターン

強制ゲートのためにGitHub ActionsでAgentShieldを使用:

```yaml
- uses: affaan-m/agentshield@v1
  with:
    path: "."
    min-severity: "medium"
    fail-on-findings: true
```

## リンク

- スキル: `skills/security-scan/SKILL.md`
- エージェント: `agents/security-reviewer.md`
- スキャナー: <https://github.com/affaan-m/agentshield>

## 引数

$ARGUMENTS:
- オプションのターゲットパス
- オプションのAgentShieldフラグ
