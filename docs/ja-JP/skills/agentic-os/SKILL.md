---
name: agentic-os
description: Claude Code 上に永続的なマルチエージェントオペレーティングシステムを構築します。カーネルアーキテクチャ、スペシャリストエージェント、スラッシュコマンド、ファイルベースのメモリ、スケジュールされた自動化、外部データベースなしの状態管理をカバーします。
origin: ECC
---

# エージェニック OS

Claude Code をチャットセッションではなく永続的なランタイム / オペレーティングシステムとして扱います。このスキルは本番のエージェニックセットアップで使用されるアーキテクチャを成文化します：スペシャリストエージェントにタスクをルーティングするカーネル設定、永続的なファイルベースのメモリ、スケジュールされた自動化、JSON/Markdown データ層。

## 起動タイミング

- Claude Code 内でマルチエージェントワークフローを構築する
- セッション再起動後も維持される永続的な Claude Code 自動化をセットアップする
- 繰り返しタスク向けの「パーソナル OS」または「エージェニック OS」を作成する
- ユーザーが「エージェニック OS」、「パーソナル OS」、「マルチエージェント」、「エージェントコーディネーター」、「永続エージェント」と言う
- コンテキストがセッションをまたいで維持される必要がある長期プロジェクトを構造化する

## アーキテクチャ概要

エージェニック OS には 4 つの層があります。各層はプロジェクトルートのディレクトリです。

```
project-root/
├── CLAUDE.md          # カーネル: アイデンティティ、ルーティングルール、エージェントレジストリ
├── agents/            # スペシャリストエージェント定義（Markdown プロンプト）
├── .claude/commands/  # スラッシュコマンド: ユーザー向け CLI
├── scripts/           # デーモンスクリプト: スケジュールまたはイベント駆動タスク
└── data/              # 状態: JSON/Markdown ファイルシステム、外部 DB なし
```

### 層の責任

| 層 | 目的 | 永続化 |
|---|---|---|
| カーネル（`CLAUDE.md`） | アイデンティティ、ルーティング、モデルポリシー、エージェントレジストリ | Git 追跡 |
| エージェント（`agents/`） | スコープされたツールとメモリを持つスペシャリストアイデンティティ | Git 追跡 |
| コマンド（`.claude/commands/`） | ユーザー向けスラッシュコマンド（`/daily-sync`、`/outreach`） | Git 追跡 |
| スクリプト（`scripts/`） | cron またはウェブフックによってトリガーされる Python/JS デーモン | Git 追跡 |
| 状態（`data/`） | 追記専用ログ、プロジェクト状態、決定記録 | Git 無視または追跡 |

## カーネル

`CLAUDE.md` はカーネルです。COO / オーケストレーターとして機能します。Claude はセッション開始時にそれを読み、作業をルーティングするために使用します。

### カーネル構造

```markdown
# CLAUDE.md - エージェニック OS カーネル

## アイデンティティ
あなたは [project-name] の COO です。タスクをスペシャリストエージェントにルーティングします。
コードは直接書きません。適切なエージェントに委任し、結果を統合します。

## エージェントレジストリ

| エージェント | ロール | トリガー |
|---|---|---|
| @dev | コード、アーキテクチャ、デバッグ | ユーザーが「build」、「fix」、「refactor」と言う |
| @writer | ドキュメント、コンテンツ、メール | ユーザーが「write」、「draft」、「blog」と言う |
| @researcher | 調査、分析、事実確認 | ユーザーが「research」、「analyze」、「compare」と言う |
| @ops | DevOps、デプロイ、インフラ | ユーザーが「deploy」、「CI」、「server」と言う |

## ルーティングルール
1. ユーザーリクエストのインテントキーワードを解析する
2. エージェントレジストリのトリガー列にマッチさせる
3. `agents/<name>.md` から対応するエージェントファイルをロードする
4. 完全なコンテキストでハンドオフ実行する
5. 結果を統合してユーザーに提示する

## モデルポリシー
- デフォルトモデル: リポジトリまたはハーネスのデフォルトを使用する。
- @dev タスク: 複雑なアーキテクチャには高い推論モデルを優先する。
- @researcher タスク: 設定された調査対応モデルと承認された検索ツールを使用する。
- コストの上限: プロジェクトの設定された支出閾値を超える前に警告する。
```

### 重要な原則

カーネルは**小さく宣言的**であるべきです。ルーティングロジックはコードではなく Markdown テーブルに記載します。これによりシステムはデバッグなしに検査・編集可能になります。

## スペシャリストエージェント

各エージェントは `agents/` のスタンドアロン Markdown ファイルです。Claude はタスクをルーティングする際に関連するエージェントファイルをロードします。

### エージェント定義フォーマット

```markdown
# @dev - ソフトウェアエンジニア

## アイデンティティ
あなたはシニアソフトウェアエンジニアです。クリーンで、テスト済みの、本番グレードのコードを書きます。
シンプルなソリューションを好みます。要件が曖昧な場合は明確化の質問をします。

## メモリスコープ
- コンテキストのために `data/projects/<current-project>.md` を読む
- アーキテクチャ決定のために `data/decisions/` を読む
- 実行ログを `data/logs/<date>-@dev.md` に追記する

## ツールアクセス
- プロジェクトルート内のフルファイルシステムアクセス
- Git 操作（status、diff、commit、branch）
- テストランナーアクセス
- `.claude/mcp.json` で設定された MCP サーバー

## 制約
- 新機能には常にテストを書く
- `main` に直接コミットしない；フィーチャーブランチを使用する
- 新しいファイルを作成するより既存のファイルを編集することを優先する
- 可能な限り関数を 50 行未満に保つ
```

### マルチエージェント連携パターン

タスクが複数のエージェントにまたがる場合、カーネルはそれらを順次または並行して実行します：

```
ユーザー: 「ランディングページを作ってローンチブログ記事を書いて」

カーネルルーティング:
1. @dev - 「[要件] でランディングページを作成する」
2. @writer - 「ランディングページのコピーを使って [プロダクト] のローンチブログ記事を書く」
3. カーネルが両方の出力を統合した応答に統合する
```

並行実行のために、Claude Code のバックグラウンドタスク機能や特定のエージェントコンテキストで Claude Code を呼び出すシェルスクリプトを使用します。

## コマンドと毎日のワークフロー

スラッシュコマンドは `.claude/commands/` の Markdown ファイルです。再利用可能なワークフローを定義します。

### コマンド構造

```markdown
# /daily-sync

朝のブリーフィングを実行する：

1. コンテキストのために `data/logs/last-sync.md` を読む
2. プロジェクト状態を確認する：`git status`、保留中の PR、CI の健全性
3. 新しいタスクや必要な決定のために `data/inbox/` を確認する
4. ブロッカー、優先事項、次のアクションのサマリーを生成する
5. ブリーフィングを `data/logs/daily/<date>.md` に追記する
```

### 標準コマンドセット

| コマンド | 目的 |
|---|---|
| `/daily-sync` | 朝のブリーフィング：状態、ブロッカー、優先事項 |
| `/outreach` | アウトリーチワークフローを実行する（メール、LinkedIn など） |
| `/research <topic>` | 引用追跡付きの詳細な調査 |
| `/apply-jobs` | 対象ロール向けに履歴書とカバーレターをカスタマイズする |
| `/analytics` | Stripe、GitHub、またはカスタムソースからメトリクスを取得する |
| `/interview-prep` | フラッシュカードまたはモック面接質問を生成する |
| `/decision <topic>` | 賛否と選択したパスで決定を記録する |

### コマンドの有効化

コマンドファイルを `.claude/commands/<command-name>.md` に配置します。Claude Code はそれらを自動検出します。ユーザーは `/<command-name>` で呼び出します。

## 永続メモリ

メモリはファイルベースです。ベクトル DB なし、Redis なし、PostgreSQL なし。`data/` の JSON と Markdown ファイルがデータベースです。

### メモリディレクトリ構造

```
data/
├── daily-logs/         # 追記専用の毎日のアクティビティログ
├── projects/           # プロジェクトごとのコンテキストファイル
├── decisions/          # アーキテクチャとビジネスの決定（ADR フォーマット）
├── inbox/              # トリアージ待ちの新しいタスクやアイデア
├── contacts/           # 人、会社、関係のノート
└── templates/          # 再利用可能なプロンプトとフォーマット
```

### 毎日のログフォーマット

```markdown
# 2026-04-22 - 毎日のログ

## セッション
- 09:00 - セッション 1: 認証モジュールのリファクタリング（@dev）
- 11:30 - セッション 2: 投資家向けアップデートの下書き（@writer）

## 決定
- JWT からセッション Cookie に切り替え（`data/decisions/2026-04-22-auth.md` を参照）

## ブロッカー
- ベンダーからの API キー待ち（2026-04-24 にフォローアップ）

## 次のアクション
- [ ] 認証リファクタリング PR をマージする
- [ ] 投資家向けアップデートをレビュー用に送信する
```

### 自動リフレクションパターン

各セッションの終わりに、カーネルはリフレクションを追記します：

```markdown
## リフレクション - セッション 3
- 機能したこと: 並行エージェント実行で 20 分節約
- 機能しなかったこと: @researcher がペイウォールのあるソースにヒット、より良いソースランキングが必要
- 変更すべきこと: 調査ノートに `source-tier` フィールドを追加する（A/B/C の信頼性）
```

これによりコードを変更することなく時間とともにシステムを改善するフィードバックループが作られます。

## スケジュールされた自動化

エージェニック OS タスクは、セッションが終了すると停止する Claude Code の組み込み cron ではなく、外部 cron を使用してスケジュールで実行されます。

### macOS: LaunchAgent

```xml
<!-- ~/Library/LaunchAgents/com.agentic.daily-sync.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ...>
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agentic.daily-sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>/claude</string>
        <string>--cwd</string>
        <string>/path/to/project</string>
        <string>--command</string>
        <string>/daily-sync</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>8</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/agentic-daily-sync.log</string>
</dict>
</plist>
```

### Linux: systemd タイマー

```ini
# ~/.config/systemd/user/agentic-daily-sync.service
[Unit]
Description=Agentic OS Daily Sync

[Service]
Type=oneshot
ExecStart=/usr/local/bin/claude --cwd /path/to/project --command /daily-sync
```

```ini
# ~/.config/systemd/user/agentic-daily-sync.timer
[Unit]
Description=毎朝のデイリーシンクを実行する

[Timer]
OnCalendar=*-*-* 8:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

### クロスプラットフォーム: pm2

```bash
# ecosystem.config.js
module.exports = {
  apps: [{
    name: 'agentic-daily-sync',
    script: 'claude',
    args: '--cwd /path/to/project --command /daily-sync',
    cron_restart: '0 8 * * *',
    autorestart: false
  }]
};
```

## データ層

データ層はファイルシステムです。構造化データには JSON を、ナラティブコンテンツには Markdown を使用します。

### 構造化状態用 JSON

```json
// data/projects/website-v2.json
{
  "name": "Website v2",
  "status": "in-progress",
  "milestone": "beta-launch",
  "agents_involved": ["@dev", "@writer"],
  "files": {
    "spec": "docs/website-v2-spec.md",
    "design": "designs/website-v2.fig"
  },
  "metrics": {
    "commits": 47,
    "last_session": "2026-04-22T11:30:00Z"
  }
}
```

### ナラティブ用 Markdown

決定、ログ、調査ノート、連絡先記録など人間が読むものには Markdown を使用します。

### スキーマの進化

既存のフィールドを改名しないこと。新しいフィールドを追加し、古いものを非推奨としてマークする：

```json
{
  "name": "Website v2",
  "status": "in-progress",
  "milestone": "beta-launch",
  "_deprecated_priority": "high",
  "priority_v2": { "level": "high", "rationale": "Blocks investor demo" }
}
```

これにより移行スクリプトなしに過去のデータが読める状態を保ちます。

## アンチパターン

### モノリシックな単一エージェント

```markdown
# 悪い例 - 1 つのエージェントがすべてを行う
あなたはフルスタック開発者、ライター、リサーチャー、DevOps エンジニアです。
```

スペシャリストエージェントに分割します。カーネルがルーティングを処理します。

### ステートレスなセッション

```markdown
# 悪い例 - セッション間にメモリなし
Claude Code が開くたびに最初から始める。
```

セッション開始時に常に `data/` を読み、セッション終了時に書き戻します。

### ハードコードされた認証情報

```markdown
# 悪い例 - エージェントファイルまたは CLAUDE.md に API キー
あなたの OpenAI API キーは sk-xxxxxxxx です
```

環境変数またはスクリプトによってロードされる `.env` ファイルを使用します。エージェントは `process.env.API_KEY` を参照します。

### シンプルな状態に外部データベース

```markdown
# 悪い例 - ソロユーザーのエージェニック OS に PostgreSQL
```

複数の同時ユーザーまたはデータが GB になるまで JSON/Markdown ファイルを使用します。

### 過度にエンジニアリングされたルーティング

```markdown
# 悪い例 - Markdown テーブルではなくコードのルーティングロジック
if (intent.includes('deploy')) { agent = opsAgent; }
```

ルーティングを `CLAUDE.md` の Markdown テーブルで宣言的に保ちます。検査・編集・デバッグが可能です。

## ベストプラクティス

- [ ] `CLAUDE.md` は 200 行未満でコンテキストウィンドウに収まる
- [ ] 各エージェントファイルは 100 行未満で 1 つのドメインに集中している
- [ ] `data/` は機密ログは Git 無視、決定と仕様は Git 追跡
- [ ] コマンドは命令形の名前を使用する：`/daily-sync`、`/run-daily-sync` ではない
- [ ] ログは追記専用；過去の毎日のログを編集しない
- [ ] すべてのエージェントには読むファイルを定義する `Memory Scope` セクションがある
- [ ] リフレクションはすべてのセッションの終わりに書かれる
- [ ] スケジュールされたタスクは Claude Code のセッション cron ではなく外部 cron（LaunchAgent、systemd、pm2）を使用する
- [ ] コスト追跡: `data/logs/<date>-costs.json` にセッションごとの API 支出をログに記録する
- [ ] 1 プロジェクト = 1 エージェニック OS。無関係なプロジェクト間で単一の `CLAUDE.md` を共有しない。
