---
name: jira-integration
description: Jira チケットの取得、要件分析、チケットステータスの更新、コメントの追加、またはイシューのトランジションを行う際に使用します。MCP または直接 REST 呼び出しによる Jira API パターンを提供します。
origin: ECC
---

# Jira インテグレーションスキル

AI コーディングワークフローから直接 Jira チケットを取得・分析・更新します。**MCP ベース**（推奨）と**直接 REST API** の両アプローチをサポートします。

## アクティベートするタイミング

- 要件を理解するために Jira チケットを取得する
- チケットからテスト可能な受け入れ基準を抽出する
- Jira イシューに進捗コメントを追加する
- チケットステータスをトランジションする（To Do → In Progress → Done）
- マージリクエストやブランチを Jira イシューにリンクする
- JQL クエリでイシューを検索する

## 前提条件

### オプション A: MCP サーバー（推奨）

`mcp-atlassian` MCP サーバーをインストールします。これにより Jira ツールが AI エージェントに直接公開されます。

**要件:**
- Python 3.10 以上
- `uvx`（`uv` から）、パッケージマネージャーまたは公式 `uv` インストールドキュメントからインストール

**MCP 設定に追加**（例: `~/.claude.json` → `mcpServers`）:

```json
{
  "jira": {
    "command": "uvx",
    "args": ["mcp-atlassian==0.21.0"],
    "env": {
      "JIRA_URL": "https://YOUR_ORG.atlassian.net",
      "JIRA_EMAIL": "your.email@example.com",
      "JIRA_API_TOKEN": "your-api-token"
    },
    "description": "Jira issue tracking — search, create, update, comment, transition"
  }
}
```

> **セキュリティ:** シークレットをハードコードしないでください。`JIRA_URL`、`JIRA_EMAIL`、`JIRA_API_TOKEN` はシステム環境変数またはシークレットマネージャーに設定することを推奨します。MCP の `env` ブロックはローカルのコミットされていない設定ファイルにのみ使用してください。

**Jira API トークンの取得方法:**
1. <https://id.atlassian.com/manage-profile/security/api-tokens> にアクセス
2. **API トークンを作成**をクリック
3. トークンをコピーして環境変数に保存（ソースコードには絶対に保存しない）

### オプション B: 直接 REST API

MCP が利用できない場合は、`curl` またはヘルパースクリプトで Jira REST API v3 を直接使用します。

**必要な環境変数:**

| 変数 | 説明 |
|------|------|
| `JIRA_URL` | Jira インスタンスの URL（例: `https://yourorg.atlassian.net`） |
| `JIRA_EMAIL` | Atlassian アカウントのメールアドレス |
| `JIRA_API_TOKEN` | id.atlassian.com からの API トークン |

シェル環境変数、シークレットマネージャー、またはリポジトリにコミットしないローカル環境ファイルに保存してください。

直接 `curl` 例では、Jira ユーザー設定を標準入力で渡し、認証情報がコマンドライン引数に出ないようにします。

```bash
jira_curl() {
  printf 'user = "%s:%s"\n' "$JIRA_EMAIL" "$JIRA_API_TOKEN" |
    curl -s -K - "$@"
}
```

## MCP ツールリファレンス

`mcp-atlassian` MCP サーバーが設定されている場合、以下のツールが利用可能です。

| ツール | 目的 | 例 |
|--------|------|-----|
| `jira_search` | JQL クエリ | `project = PROJ AND status = "In Progress"` |
| `jira_get_issue` | キーで完全なイシュー詳細を取得 | `PROJ-1234` |
| `jira_create_issue` | イシューの作成（タスク、バグ、ストーリー、エピック） | 新しいバグレポート |
| `jira_update_issue` | フィールドの更新（概要、説明、担当者） | 担当者の変更 |
| `jira_transition_issue` | ステータスの変更 | "In Review" に移動 |
| `jira_add_comment` | コメントの追加 | 進捗更新 |
| `jira_get_sprint_issues` | スプリント内のイシュー一覧 | アクティブスプリントレビュー |
| `jira_create_issue_link` | イシューのリンク（Blocks、Relates to） | 依存関係の追跡 |
| `jira_get_issue_development_info` | リンクされた PR、ブランチ、コミットの確認 | 開発コンテキスト |

> **ヒント:** トランジション前に必ず `jira_get_transitions` を呼び出してください。トランジション ID はプロジェクトのワークフローによって異なります。

## 直接 REST API リファレンス

### チケットの取得

```bash
jira_curl \
  -H "Content-Type: application/json" \
  "$JIRA_URL/rest/api/3/issue/PROJ-1234" | jq '{
    key: .key,
    summary: .fields.summary,
    status: .fields.status.name,
    priority: .fields.priority.name,
    type: .fields.issuetype.name,
    assignee: .fields.assignee.displayName,
    labels: .fields.labels,
    description: .fields.description
  }'
```

### コメントの取得

```bash
jira_curl \
  -H "Content-Type: application/json" \
  "$JIRA_URL/rest/api/3/issue/PROJ-1234?fields=comment" | jq '.fields.comment.comments[] | {
    author: .author.displayName,
    created: .created[:10],
    body: .body
  }'
```

### コメントの追加

```bash
jira_curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "body": {
      "version": 1,
      "type": "doc",
      "content": [{
        "type": "paragraph",
        "content": [{"type": "text", "text": "Your comment here"}]
      }]
    }
  }' \
  "$JIRA_URL/rest/api/3/issue/PROJ-1234/comment"
```

### チケットのトランジション

```bash
# 1. 利用可能なトランジションを取得
jira_curl \
  "$JIRA_URL/rest/api/3/issue/PROJ-1234/transitions" | jq '.transitions[] | {id, name: .name}'

# 2. トランジションを実行（TRANSITION_ID を置き換える）
jira_curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"transition": {"id": "TRANSITION_ID"}}' \
  "$JIRA_URL/rest/api/3/issue/PROJ-1234/transitions"
```

### JQL での検索

```bash
jira_curl -G \
  --data-urlencode "jql=project = PROJ AND status = 'In Progress'" \
  "$JIRA_URL/rest/api/3/search"
```

## チケットの分析

開発またはテスト自動化のためにチケットを取得する際に抽出する内容:

### 1. テスト可能な要件
- **機能要件** — 機能が行うこと
- **受け入れ基準** — 満たさなければならない条件
- **テスト可能な振る舞い** — 具体的なアクションと期待される結果
- **ユーザーロール** — この機能を使用するのは誰か、その権限
- **データ要件** — 必要なデータ
- **インテグレーションポイント** — 関係する API、サービス、またはシステム

### 2. 必要なテストタイプ
- **ユニットテスト** — 個別の関数とユーティリティ
- **インテグレーションテスト** — API エンドポイントとサービスインタラクション
- **E2E テスト** — ユーザー向け UI フロー
- **API テスト** — エンドポイントコントラクトとエラーハンドリング

### 3. エッジケースとエラーシナリオ
- 無効な入力（空、長すぎる、特殊文字）
- 不正アクセス
- ネットワーク障害またはタイムアウト
- 同時ユーザーまたはレース条件
- 境界条件
- データの欠如または null 値
- 状態遷移（ナビゲーションの戻り、リフレッシュなど）

### 4. 構造化された分析出力

```
Ticket: PROJ-1234
Summary: [チケットタイトル]
Status: [現在のステータス]
Priority: [High/Medium/Low]
Test Types: Unit, Integration, E2E

Requirements:
1. [要件 1]
2. [要件 2]

Acceptance Criteria:
- [ ] [基準 1]
- [ ] [基準 2]

Test Scenarios:
- Happy Path: [説明]
- Error Case: [説明]
- Edge Case: [説明]

Test Data Needed:
- [データ項目 1]
- [データ項目 2]

Dependencies:
- [依存関係 1]
- [依存関係 2]
```

## チケットの更新

### 更新するタイミング

| ワークフローステップ | Jira の更新 |
|---|---|
| 作業開始 | "In Progress" にトランジション |
| テスト作成完了 | テストカバレッジサマリーをコメント |
| ブランチ作成 | ブランチ名をコメント |
| PR/MR 作成 | リンク付きコメント、イシューをリンク |
| テスト通過 | 結果サマリーをコメント |
| PR/MR マージ | "Done" または "In Review" にトランジション |

### コメントテンプレート

**作業開始:**
```
Starting implementation for this ticket.
Branch: feat/PROJ-1234-feature-name
```

**テスト実装完了:**
```
Automated tests implemented:

Unit Tests:
- [テストファイル 1] — [カバー内容]
- [テストファイル 2] — [カバー内容]

Integration Tests:
- [テストファイル] — [カバーするエンドポイント/フロー]

All tests passing locally. Coverage: XX%
```

**PR 作成:**
```
Pull request created:
[PR Title](https://github.com/org/repo/pull/XXX)

Ready for review.
```

**作業完了:**
```
Implementation complete.

PR merged: [link]
Test results: All passing (X/Y)
Coverage: XX%
```

## セキュリティガイドライン

- Jira API トークンをソースコードやスキルファイルに**絶対にハードコードしない**
- 環境変数またはシークレットマネージャーを**必ず使用する**
- すべてのプロジェクトで `.env` を `.gitignore` に**追加する**
- git 履歴に露出した場合はトークンを即座に**ローテーションする**
- 必要なプロジェクトに限定した**最小権限** API トークンを使用する
- API 呼び出し前に認証情報が設定されているか**検証する** — 明確なメッセージとともに早期に失敗させる

## トラブルシューティング

| エラー | 原因 | 対処法 |
|---|---|---|
| `401 Unauthorized` | API トークンが無効または期限切れ | id.atlassian.com で再生成 |
| `403 Forbidden` | トークンにプロジェクト権限がない | トークンのスコープとプロジェクトアクセスを確認 |
| `404 Not Found` | チケットキーまたはベース URL が間違っている | `JIRA_URL` とチケットキーを確認 |
| `spawn uvx ENOENT` | IDE が PATH で `uvx` を見つけられない | フルパス（例: `~/.local/bin/uvx`）を使用するか、`~/.zprofile` に PATH を設定 |
| 接続タイムアウト | ネットワーク/VPN の問題 | VPN 接続とファイアウォールルールを確認 |

## ベストプラクティス

- 最後にまとめてではなく、作業しながら Jira を更新する
- コメントは簡潔かつ情報量のあるものにする
- コピーではなくリンクする — PR、テストレポート、ダッシュボードへのリンクを貼る
- 他の人の意見が必要な場合は @メンションを使う
- 作業を開始する前に、機能の全体的なスコープを理解するためにリンクされたイシューを確認する
- 受け入れ基準が曖昧な場合は、コードを書く前に明確化を求める
