# Everything Claude Code 簡潔ガイド

![Header: Anthropic Hackathon Winner - Tips & Tricks for Claude Code](./assets/images/shortform/00-header.png)

---

**2月の実験的ロールアウト以来、熱心なClaude Codeユーザーとして活動し、[@DRodriguezFX](https://x.com/DRodriguezFX)と共に[zenith.chat](https://zenith.chat)でAnthropic x Forum Venturesハッカソンで優勝しました — すべてClaude Codeを使用して。**

10ヶ月の日常使用後の完全なセットアップをご紹介：スキル、フック、サブエージェント、MCP、プラグイン、そして実際に機能するもの。

---

## スキルとコマンド

スキルは主要なワークフローサーフェスです。スコープされたワークフローバンドルとして機能します：再利用可能なプロンプト、構造、サポートファイル、特定の実行パターンが必要な際のコードマップ。

Opus 4.5での長いコーディングセッション後にデッドコードや散らかった.mdファイルを整理したい？`/refactor-clean`を実行。テストが必要？`/tdd`、`/e2e`、`/test-coverage`。これらのスラッシュエントリーは便利ですが、真に持続的な単位は基盤となるスキルです。スキルにはコードマップも含められます — コンテキストを探索に消費せずにClaude がコードベースを素早くナビゲートする方法です。

![Terminal showing chained commands](./assets/images/shortform/02-chaining-commands.jpeg)
*コマンドの連鎖実行*

ECCは依然として`commands/`レイヤーを提供していますが、マイグレーション中のレガシースラッシュエントリー互換性と考えるのが最適です。持続的なロジックはスキルに置くべきです。

- **スキル**: `~/.claude/skills/` - 正規のワークフロー定義
- **コマンド**: `~/.claude/commands/` - まだ必要な場合のレガシースラッシュエントリーシム

```bash
# スキル構造の例
~/.claude/skills/
  pmx-guidelines.md      # プロジェクト固有パターン
  coding-standards.md    # 言語のベストプラクティス
  tdd-workflow/          # SKILL.md付きマルチファイルスキル
  security-review/       # チェックリストベースのスキル
```

---

## フック

フックは特定のイベントで発火するトリガーベースの自動化です。スキルとは異なり、ツール呼び出しとライフサイクルイベントに制約されます。

**フックタイプ：**

1. **PreToolUse** - ツール実行前（バリデーション、リマインダー）
2. **PostToolUse** - ツール完了後（フォーマット、フィードバックループ）
3. **UserPromptSubmit** - メッセージ送信時
4. **Stop** - Claudeの応答完了時
5. **PreCompact** - コンテキスト圧縮前
6. **Notification** - パーミッションリクエスト

**例：長時間実行コマンド前のtmuxリマインダー**

```json
{
  "PreToolUse": [
    {
      "matcher": "tool == \"Bash\" && tool_input.command matches \"(npm|pnpm|yarn|cargo|pytest)\"",
      "hooks": [
        {
          "type": "command",
          "command": "if [ -z \"$TMUX\" ]; then echo '[Hook] Consider tmux for session persistence' >&2; fi"
        }
      ]
    }
  ]
}
```

![PostToolUse hook feedback](./assets/images/shortform/03-posttooluse-hook.png)
*PostToolUseフック実行中のClaude Codeでのフィードバック例*

**プロヒント：** JSONを手動で書く代わりに`hookify`プラグインを使ってフックを会話的に作成できます。`/hookify`を実行して欲しいものを説明してください。

---

## サブエージェント

サブエージェントは、オーケストレーター（メインのClaude）が限定されたスコープでタスクを委任できるプロセスです。バックグラウンドまたはフォアグラウンドで実行でき、メインエージェントのコンテキストを解放します。

サブエージェントはスキルとうまく連携します — スキルのサブセットを実行できるサブエージェントにタスクを委任し、それらのスキルを自律的に使用させることができます。また、特定のツールパーミッションでサンドボックス化もできます。

```bash
# サブエージェント構造の例
~/.claude/agents/
  planner.md           # 機能実装の計画
  architect.md         # システム設計の意思決定
  tdd-guide.md         # テスト駆動開発
  code-reviewer.md     # 品質/セキュリティレビュー
  security-reviewer.md # 脆弱性分析
  build-error-resolver.md
  e2e-runner.md
  refactor-cleaner.md
```

サブエージェントごとに許可するツール、MCP、パーミッションを設定して適切にスコープしてください。

---

## ルールとメモリ

`.rules`フォルダには、Claudeが**常に**従うべきベストプラクティスを含む`.md`ファイルが格納されます。2つのアプローチ：

1. **単一CLAUDE.md** - すべてを1ファイルに（ユーザーまたはプロジェクトレベル）
2. **ルールフォルダ** - 関心事ごとにグループ化されたモジュラーな`.md`ファイル

```bash
~/.claude/rules/
  security.md      # ハードコードされたシークレット禁止、入力バリデーション
  coding-style.md  # イミュータビリティ、ファイル構成
  testing.md       # TDDワークフロー、80%カバレッジ
  git-workflow.md  # コミット形式、PRプロセス
  agents.md        # サブエージェントへの委任タイミング
  performance.md   # モデル選択、コンテキスト管理
```

**ルールの例：**

- コードベースに絵文字を使わない
- フロントエンドで紫系の色を控える
- デプロイ前に必ずコードをテスト
- メガファイルよりモジュラーなコードを優先
- console.logをコミットしない

---

## MCP（Model Context Protocol）

MCPはClaudeを外部サービスに直接接続します。APIの置き換えではなく、プロンプト駆動のラッパーであり、情報のナビゲーションに柔軟性を提供します。

**例：** Supabase MCPにより、Claudeはコピー&ペーストなしで特定のデータを取得し、上流で直接SQLを実行できます。データベース、デプロイメントプラットフォームなども同様です。

![Supabase MCP listing tables](./assets/images/shortform/04-supabase-mcp.jpeg)
*Supabase MCPがpublicスキーマ内のテーブルを一覧表示している例*

**Claude内のChrome：** Claudeがブラウザを自律的に制御する組み込みプラグインMCP — クリックして動作を確認できます。

**重要：コンテキストウィンドウ管理**

MCPは厳選してください。すべてのMCPをユーザー設定に入れていますが、**未使用のものはすべて無効化**しています。`/plugins`に移動してスクロールするか、`/mcp`を実行してください。

![/plugins interface](./assets/images/shortform/05-plugins-interface.jpeg)
*/pluginsを使用してMCPのインストール状況とステータスを確認*

圧縮前の200kコンテキストウィンドウも、有効なツールが多すぎると70kにしかならない場合があります。パフォーマンスが大幅に低下します。

**目安：** 設定に20〜30のMCPを持ちつつ、有効は10未満 / アクティブなツールは80未満に。

```bash
# 有効なMCPを確認
/mcp

# 未使用のものを ~/.claude/settings.json または現在のリポジトリの .mcp.json で無効化
```

---

## プラグイン

プラグインは面倒な手動セットアップの代わりにツールを簡単にインストールできるようパッケージ化します。プラグインはスキル + MCPの組み合わせ、またはフック/ツールのバンドルが可能です。

**プラグインのインストール：**

```bash
# マーケットプレイスを追加
# @mixedbread-ai による mgrep プラグイン
claude plugin marketplace add https://github.com/mixedbread-ai/mgrep

# Claudeを開き、/plugins を実行、新しいマーケットプレイスを見つけてインストール
```

![Marketplaces tab showing mgrep](./assets/images/shortform/06-marketplaces-mgrep.jpeg)
*新しくインストールされたMixedbread-Grepマーケットプレイスの表示*

**LSPプラグイン**は、エディタ外でClaude Codeを頻繁に使用する場合に特に便利です。Language Server Protocolにより、IDEを開かずにClaudeにリアルタイムの型チェック、定義ジャンプ、インテリジェント補完を提供します。

```bash
# 有効なプラグインの例
typescript-lsp@claude-plugins-official  # TypeScriptインテリジェンス
pyright-lsp@claude-plugins-official     # Python型チェック
hookify@claude-plugins-official         # フックを会話的に作成
mgrep@Mixedbread-Grep                   # ripgrepより優れた検索
```

MCPと同じ警告 — コンテキストウィンドウに注意。

---

## ヒントとコツ

### キーボードショートカット

- `Ctrl+U` - 行全体を削除（バックスペース連打より速い）
- `!` - クイックbashコマンドプレフィックス
- `@` - ファイル検索
- `/` - スラッシュコマンドの開始
- `Shift+Enter` - 複数行入力
- `Tab` - シンキング表示の切り替え
- `Esc Esc` - Claudeの中断 / コード復元

### 並列ワークフロー

- **フォーク**（`/fork`）— 会話をフォークして重複しないタスクを並列実行（キューイングされたメッセージの連打の代わりに）
- **Gitワークツリー** — 競合なしで重複する並列Claudeを実行。各ワークツリーは独立したチェックアウト

```bash
git worktree add ../feature-branch feature-branch
# 各ワークツリーで別々のClaudeインスタンスを実行
```

### 長時間実行コマンド用tmux

Claudeが実行するログ/bashプロセスのストリーミングと監視：

```bash
tmux new -s dev
# Claudeがここでコマンドを実行、デタッチして再アタッチ可能
tmux attach -t dev
```

### mgrep > grep

`mgrep`はripgrep/grepからの大幅な改善です。プラグインマーケットプレイスからインストールし、`/mgrep`スキルを使用。ローカル検索とWeb検索の両方に対応。

```bash
mgrep "function handleSubmit"  # ローカル検索
mgrep --web "Next.js 15 app router changes"  # Web検索
```

### その他の便利なコマンド

- `/rewind` - 以前の状態に戻る
- `/statusline` - ブランチ、コンテキスト%、Todoでカスタマイズ
- `/checkpoints` - ファイルレベルのアンドゥポイント
- `/compact` - コンテキスト圧縮を手動トリガー

### GitHub Actions CI/CD

GitHub ActionsでPRにコードレビューを設定。設定すればClaudeがPRを自動的にレビューできます。

![Claude bot approving a PR](./assets/images/shortform/08-github-pr-review.jpeg)
*Claudeがバグ修正PRを承認*

### サンドボックス

リスクのある操作にはサンドボックスモードを使用 — Claudeは実際のシステムに影響を与えない制限された環境で実行されます。

---

## エディタについて

エディタの選択はClaude Codeのワークフローに大きく影響します。Claude Codeは任意のターミナルから動作しますが、高機能なエディタと組み合わせることで、リアルタイムのファイル追跡、素早いナビゲーション、統合されたコマンド実行が可能になります。

### Zed（私の推奨）

[Zed](https://zed.dev)を使用しています — Rustで書かれているため、本当に高速です。即座に開き、巨大なコードベースも問題なく処理し、システムリソースをほとんど消費しません。

**Zed + Claude Codeが優れた組み合わせである理由：**

- **速度** — Rustベースのパフォーマンスにより、Claudeがファイルを素早く編集しても遅延なし。エディタがついてこれる
- **エージェントパネル統合** — ZedのClaude統合により、Claudeの編集に伴うファイル変更をリアルタイムで追跡。Claudeが参照するファイル間をエディタを離れずにジャンプ
- **CMD+Shift+R コマンドパレット** — カスタムスラッシュコマンド、デバッガー、ビルドスクリプトへの検索可能なUIでの素早いアクセス
- **最小限のリソース使用** — 重い操作中にClaudeとRAM/CPUを競合しない。Opus実行時に重要
- **Vimモード** — お好みならフルVimキーバインド

![Zed Editor with custom commands](./assets/images/shortform/09-zed-editor.jpeg)
*CMD+Shift+Rでカスタムコマンドドロップダウンを表示するZedエディタ。右下にフォローモードが牛眼として表示。*

**エディタに依存しないヒント：**

1. **画面を分割** — 片側にClaude Codeのターミナル、もう片側にエディタ
2. **Ctrl + G** — Claudeが現在作業中のファイルをZedで素早く開く
3. **自動保存** — 自動保存を有効にしてClaudeのファイル読み取りが常に最新に
4. **Git統合** — エディタのgit機能を使ってコミット前にClaudeの変更をレビュー
5. **ファイルウォッチャー** — ほとんどのエディタは変更されたファイルを自動リロード、有効になっているか確認

### VSCode / Cursor

これも実用的な選択肢でClaude Codeとうまく連携します。`\ide`でLSP機能を有効にしたターミナル形式（プラグインでやや冗長になりました）、またはエディタにより統合されたマッチするUIの拡張機能を選択できます。

![VS Code Claude Code Extension](./assets/images/shortform/10-vscode-extension.jpeg)
*VS Code拡張機能はClaude CodeのネイティブグラフィカルインターフェースをIDE内に直接統合して提供。*

---

## 私のセットアップ

### プラグイン

**インストール済み：**（通常、同時に有効なのは4〜5個）

```markdown
ralph-wiggum@claude-code-plugins       # ループ自動化
frontend-patterns@claude-code-plugins  # UI/UXパターン
commit-commands@claude-code-plugins    # Gitワークフロー
security-guidance@claude-code-plugins  # セキュリティチェック
pr-review-toolkit@claude-code-plugins  # PR自動化
typescript-lsp@claude-plugins-official # TSインテリジェンス
hookify@claude-plugins-official        # フック作成
code-simplifier@claude-plugins-official
feature-dev@claude-code-plugins
explanatory-output-style@claude-code-plugins
code-review@claude-code-plugins
context7@claude-plugins-official       # ライブドキュメント
pyright-lsp@claude-plugins-official    # Python型
mgrep@Mixedbread-Grep                  # より良い検索
```

### MCPサーバー

**設定済み（ユーザーレベル）：**

```json
{
  "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] },
  "firecrawl": { "command": "npx", "args": ["-y", "firecrawl-mcp"] },
  "supabase": {
    "command": "npx",
    "args": ["-y", "@supabase/mcp-server-supabase@latest", "--project-ref=YOUR_REF"]
  },
  "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] },
  "sequential-thinking": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
  },
  "vercel": { "type": "http", "url": "https://mcp.vercel.com" },
  "railway": { "command": "npx", "args": ["-y", "@railway/mcp-server"] },
  "cloudflare-docs": { "type": "http", "url": "https://docs.mcp.cloudflare.com/mcp" },
  "cloudflare-workers-bindings": {
    "type": "http",
    "url": "https://bindings.mcp.cloudflare.com/mcp"
  },
  "clickhouse": { "type": "http", "url": "https://mcp.clickhouse.cloud/mcp" },
  "AbletonMCP": { "command": "uvx", "args": ["ableton-mcp"] },
  "magic": { "command": "npx", "args": ["-y", "@magicuidesign/mcp@latest"] }
}
```

ここがポイント — 14のMCPを設定していますが、プロジェクトごとに有効なのは5〜6個のみ。コンテキストウィンドウを健全に保ちます。

### 主要フック

```json
{
  "PreToolUse": [
    { "matcher": "npm|pnpm|yarn|cargo|pytest", "hooks": ["tmuxリマインダー"] },
    { "matcher": "Write && .mdファイル", "hooks": ["README/CLAUDE以外はブロック"] },
    { "matcher": "git push", "hooks": ["レビュー用にエディタを開く"] }
  ],
  "PostToolUse": [
    { "matcher": "Edit && .ts/.tsx/.js/.jsx", "hooks": ["prettier --write"] },
    { "matcher": "Edit && .ts/.tsx", "hooks": ["tsc --noEmit"] },
    { "matcher": "Edit", "hooks": ["grep console.log 警告"] }
  ],
  "Stop": [
    { "matcher": "*", "hooks": ["変更ファイルのconsole.logチェック"] }
  ]
}
```

### カスタムステータスライン

ユーザー、ディレクトリ、ダーティインジケーター付きgitブランチ、残りコンテキスト%、モデル、時間、Todoカウントを表示：

![Custom status line](./assets/images/shortform/11-statusline.jpeg)
*Macルートディレクトリでのステータスライン例*

```
affoon:~ ctx:65% Opus 4.5 19:52
▌▌ plan mode on (shift+tab to cycle)
```

### ルール構造

```
~/.claude/rules/
  security.md      # 必須セキュリティチェック
  coding-style.md  # イミュータビリティ、ファイルサイズ制限
  testing.md       # TDD、80%カバレッジ
  git-workflow.md  # Conventional Commits
  agents.md        # サブエージェント委任ルール
  patterns.md      # APIレスポンス形式
  performance.md   # モデル選択（Haiku vs Sonnet vs Opus）
  hooks.md         # フックドキュメント
```

### サブエージェント

```
~/.claude/agents/
  planner.md           # 機能の分解
  architect.md         # システム設計
  tdd-guide.md         # テストを先に書く
  code-reviewer.md     # 品質レビュー
  security-reviewer.md # 脆弱性スキャン
  build-error-resolver.md
  e2e-runner.md        # Playwrightテスト
  refactor-cleaner.md  # デッドコード除去
  doc-updater.md       # ドキュメントの同期維持
```

---

## 重要なポイント

1. **複雑にしすぎない** — 設定はアーキテクチャではなく微調整として扱う
2. **コンテキストウィンドウは貴重** — 未使用のMCPとプラグインは無効化
3. **並列実行** — 会話をフォーク、gitワークツリーを使用
4. **繰り返しを自動化** — フォーマット、リント、リマインダー用のフック
5. **サブエージェントのスコープを限定** — 限られたツール = 集中した実行

---

## 参考文献

- [プラグインリファレンス](https://code.claude.com/docs/en/plugins-reference)
- [フックドキュメント](https://code.claude.com/docs/en/hooks)
- [チェックポイント](https://code.claude.com/docs/en/checkpointing)
- [インタラクティブモード](https://code.claude.com/docs/en/interactive-mode)
- [メモリシステム](https://code.claude.com/docs/en/memory)
- [サブエージェント](https://code.claude.com/docs/en/sub-agents)
- [MCP概要](https://code.claude.com/docs/en/mcp-overview)

---

**注意：** これは詳細の一部です。高度なパターンについては[長文ガイド](./the-longform-guide.md)を参照してください。

---

*NYCでのAnthropic x Forum Venturesハッカソンで[@DRodriguezFX](https://x.com/DRodriguezFX)と共に[zenith.chat](https://zenith.chat)を構築して優勝*
