---
description: Jiraチケットを取得し、要件を分析し、ステータスを更新し、コメントを追加します。jira-integrationスキルとMCPまたはREST APIを使用します。
---

# Jiraコマンド

ワークフローから直接Jiraチケットと対話 — チケットの取得、要件の分析、コメントの追加、ステータスの遷移。

## 使い方

```
/jira get <TICKET-KEY>          # チケットを取得して分析
/jira comment <TICKET-KEY>      # 進捗コメントを追加
/jira transition <TICKET-KEY>   # チケットステータスを変更
/jira search <JQL>              # JQLでイシューを検索
```

## このコマンドの動作

1. **取得と分析** — Jiraチケットを取得し、要件、受け入れ基準、テストシナリオ、依存関係を抽出
2. **コメント** — チケットに構造化された進捗更新を追加
3. **遷移** — ワークフローステート間でチケットを移動（To Do → In Progress → Done）
4. **検索** — JQLクエリを使用してイシューを検索

## 動作方法

### `/jira get <TICKET-KEY>`

1. Jiraからチケットを取得（MCP `jira_get_issue`またはREST API経由）
2. すべてのフィールドを抽出: サマリー、説明、受け入れ基準、優先度、ラベル、リンクされたイシュー
3. オプションで追加コンテキスト用にコメントを取得
4. 構造化された分析を出力:

```
Ticket: PROJ-1234
Summary: [タイトル]
Status: [ステータス]
Priority: [優先度]
Type: [Story/Bug/Task]

Requirements:
1. [抽出された要件]
2. [抽出された要件]

Acceptance Criteria:
- [ ] [チケットからの基準]

Test Scenarios:
- Happy Path: [説明]
- Error Case: [説明]
- Edge Case: [説明]

Dependencies:
- [リンクされたイシュー、API、サービス]

Recommended Next Steps:
- /plan で実装計画を作成
- `tdd-workflow` スキルでテストファーストで実装
```

### `/jira comment <TICKET-KEY>`

1. 現在のセッションの進捗をサマリー（何をビルド、テスト、コミットしたか）
2. 構造化されたコメントとしてフォーマット
3. Jiraチケットに投稿

### `/jira transition <TICKET-KEY>`

1. チケットの利用可能な遷移を取得
2. ユーザーにオプションを表示
3. 選択された遷移を実行

### `/jira search <JQL>`

1. Jiraに対してJQLクエリを実行
2. マッチするイシューのサマリーテーブルを返す

## 前提条件

このコマンドにはJiraの認証情報が必要です。以下のいずれかを選択:

**オプション A — MCPサーバー（推奨）:**
`mcpServers`設定に`jira`を追加（テンプレートは`mcp-configs/mcp-servers.json`を参照）。

**オプション B — 環境変数:**
```bash
export JIRA_URL="https://yourorg.atlassian.net"
export JIRA_EMAIL="your.email@example.com"
export JIRA_API_TOKEN="your-api-token"
```

認証情報が見つからない場合は、停止してユーザーにセットアップを案内します。

## 他のコマンドとの統合

チケットの分析後:
- `/plan`を使用して要件から実装計画を作成
- `tdd-workflow`スキルでテスト駆動開発で実装
- 実装後に`/code-review`を使用
- `/jira comment`で進捗をチケットに投稿
- 作業完了時に`/jira transition`でチケットを移動

## 関連

- **スキル:** `skills/jira-integration/`
- **MCP設定:** `mcp-configs/mcp-servers.json` → `jira`
