# Angular CLI MCP サーバー

Angular CLI には Model Context Protocol（MCP）サーバーが含まれており、AIアシスタント（Cursor、Gemini CLI、JetBrains AI など）が Angular CLI と直接連携できるようになります。コード生成、コードのモダナイズ、サンプルの取得、ビルド/テストの実行などのツールを提供します。

## 利用可能なツール（デフォルト）

MCPサーバーが有効な場合、AIエージェントは以下のツールにアクセスできます:

| 名前                        | 説明                                                                                                      |
| :-------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `ai_tutor`                  | インタラクティブなAI搭載のAngularチューターを起動します。                                                  |
| `find_examples`             | 最新のAngular機能に関する権威ある、ベストプラクティスのコードサンプルを検索します。                        |
| `get_best_practices`        | Angular ベストプラクティスガイドを取得します（スタンドアロンコンポーネント、型付きフォームなどに重要です）。|
| `list_projects`             | `angular.json` を読み取ってワークスペース内のすべてのアプリケーションとライブラリを一覧表示します。        |
| `onpush_zoneless_migration` | コードを解析し、`OnPush` 変更検知への移行計画を提供します（ゾーンレスの前提条件）。                        |
| `search_documentation`      | `https://angular.dev` の公式ドキュメントを検索します。                                                     |

## 実験的なツール

一部のツールは `--experimental-tool`（または `-E`）フラグを使用して明示的に有効化する必要があります。

| 名前                       | 説明                                                               |
| :------------------------- | :----------------------------------------------------------------- |
| `build`                    | `ng build` を使用して1回限りのビルドを実行します。                  |
| `devserver.start`          | 非同期的に開発サーバー（`ng serve`）を起動します。即座に返します。  |
| `devserver.stop`           | 開発サーバーを停止します。                                          |
| `devserver.wait_for_build` | 実行中の開発サーバーの最新ビルドのログを返します。                  |
| `e2e`                      | エンドツーエンドテストを実行します。                                |
| `modernize`                | 最新のベストプラクティスと構文に合わせてコードの移行を実施します。  |
| `test`                     | プロジェクトのユニットテストを実行します。                          |

## 設定

MCPサーバーを使用するには、ホスト環境（IDEまたはCLI）が `npx @angular/cli mcp` を実行するよう設定します。

### Antigravity IDE

プロジェクトのルートに `.antigravity/mcp.json` という名前のファイルを作成します:

```json
{
  "mcpServers": {
    "angular-cli": {
      "command": "npx",
      "args": ["-y", "@angular/cli", "mcp"]
    }
  }
}
```

### Gemini CLI

プロジェクトのルートに `.gemini/settings.json` を作成します:

```json
{
  "mcpServers": {
    "angular-cli": {
      "command": "npx",
      "args": ["-y", "@angular/cli", "mcp"]
    }
  }
}
```

### Cursor

プロジェクトのルートに `.cursor/mcp.json` を作成します（またはグローバルに `~/.cursor/mcp.json`）:

```json
{
  "mcpServers": {
    "angular-cli": {
      "command": "npx",
      "args": ["-y", "@angular/cli", "mcp"]
    }
  }
}
```

### VS Code

`.vscode/mcp.json` を作成します:

```json
{
  "servers": {
    "angular-cli": {
      "command": "npx",
      "args": ["-y", "@angular/cli", "mcp"]
    }
  }
}
```

## コマンドオプション

設定の `args` 配列にMCPサーバーへの引数を渡すことができます:

- `--read-only`: プロジェクトを変更しないツールのみを登録します。
- `--local-only`: インターネット接続を必要としないツールのみを登録します。
- `--experimental-tool`（`-E`）: 特定の実験的ツールを有効にします（例: `-E build`、`-E devserver`）。

実験的ツールを有効にした読み取り専用モードの例:

```json
"args": ["-y", "@angular/cli", "mcp", "--read-only", "-E", "build", "-E", "modernize"]
```
