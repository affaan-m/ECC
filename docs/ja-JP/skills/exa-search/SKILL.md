---
name: exa-search
description: Exa MCPによるウェブ、コード、企業調査のためのニューラル検索。ユーザーがウェブ検索、コード例、企業情報、人物検索、またはExaのニューラル検索エンジンを使ったAI駆動の詳細調査を必要とする場合に使用します。
origin: ECC
---

# Exa検索

> **変化が早いスキル。** Exa MCPのツール名、パラメーター、アカウント制限は変更される可能性があります。特定の検索モード、カテゴリー、またはライブクロール動作に依存する前に、公開されているツール一覧と最新のExaドキュメントを確認してください。

Exa MCPサーバーを通じたウェブコンテンツ、コード、企業、人物のニューラル検索。

## アクティベートするタイミング

- ユーザーが最新のウェブ情報やニュースを必要としている場合
- コード例、APIドキュメント、または技術的な参考資料を検索する場合
- 企業、競合他社、または市場プレイヤーを調査する場合
- あるドメインの専門家プロフィールや人物を検索する場合
- 開発タスクのバックグラウンドリサーチを行う場合
- ユーザーが「search for」「look up」「find」「what's the latest on」と言う場合

## MCP要件

Exa MCPサーバーを設定する必要があります。`~/.claude.json`に追加してください:

```json
"exa-web-search": {
  "command": "npx",
  "args": ["-y", "exa-mcp-server"],
  "env": { "EXA_API_KEY": "YOUR_EXA_API_KEY_HERE" }
}
```

APIキーは[exa.ai](https://exa.ai)で取得してください。
このリポジトリの現在のExa設定は、公開されているツール一覧を文書化しています: `web_search_exa` と `get_code_context_exa`。
Exaサーバーが追加のツールを公開している場合は、ドキュメントやプロンプトで依存する前に正確な名前を確認してください。

## コアツール

### web_search_exa
最新情報、ニュース、または事実のための一般的なウェブ検索。

```
web_search_exa(query: "latest AI developments 2026", numResults: 5)
```

**パラメーター:**

| パラメーター | 型 | デフォルト | 備考 |
|-------|------|---------|-------|
| `query` | string | 必須 | 検索クエリ |
| `numResults` | number | 8 | 結果数 |
| `type` | string | `auto` | 検索モード |
| `livecrawl` | string | `fallback` | 必要に応じてライブクロールを優先 |
| `category` | string | なし | `company` や `research paper` などのオプションフォーカス |

### get_code_context_exa
GitHub、Stack Overflow、ドキュメントサイトからコード例とドキュメントを検索。

```
get_code_context_exa(query: "Python asyncio patterns", tokensNum: 3000)
```

**パラメーター:**

| パラメーター | 型 | デフォルト | 備考 |
|-------|------|---------|-------|
| `query` | string | 必須 | コードまたはAPI検索クエリ |
| `tokensNum` | number | 5000 | コンテンツのトークン数（1000-50000） |

## 使用パターン

### クイック検索
```
web_search_exa(query: "Node.js 22 new features", numResults: 3)
```

### コード調査
```
get_code_context_exa(query: "Rust error handling patterns Result type", tokensNum: 3000)
```

### 企業・人物調査
```
web_search_exa(query: "Vercel funding valuation 2026", numResults: 3, category: "company")
web_search_exa(query: "site:linkedin.com/in AI safety researchers Anthropic", numResults: 5)
```

### 技術的な詳細調査
```
web_search_exa(query: "WebAssembly component model status and adoption", numResults: 5)
get_code_context_exa(query: "WebAssembly component model examples", tokensNum: 4000)
```

## ヒント

- 最新情報、企業検索、幅広い発見には`web_search_exa`を使用する
- `site:`、引用フレーズ、`intitle:`などの検索オペレーターを使用して結果を絞り込む
- 絞り込まれたコードスニペットには低い`tokensNum`（1000-2000）、包括的なコンテキストには高い値（5000+）を使用する
- 一般的なウェブページではなくAPIの使用方法やコード例が必要な場合は`get_code_context_exa`を使用する

## 関連スキル

- `deep-research` — firecrawl + exaを組み合わせた完全な調査ワークフロー
- `market-research` — 意思決定フレームワークを含むビジネス指向の調査
