---
name: documentation-lookup
description: 訓練データの代わりにContext7 MCP経由で最新のライブラリとフレームワークドキュメント使用。セットアップの質問、APIリファレンス、コード例、またはユーザーがフレームワーク（例：React、Next.js、Prisma）に名前を付けるときにアクティベーション。
origin: ECC
---

# ドキュメント ルックアップ（Context7）

ユーザーがライブラリ、フレームワーク、またはAPIについて尋ねるときは、訓練データに依存する代わりにContext7 MCP（ツール`resolve-library-id`および`query-docs`）を通じて現在のドキュメントをフェッチします。

## コア概念

- **Context7**：ライブドキュメントを公開するMCPサーバー；ライブラリとAPI用の訓練データの代わりに使用。
- **resolve-library-id**：ライブラリ名とクエリからContext7互換のライブラリID（例：`/vercel/next.js`）を返す。
- **query-docs**：指定されたライブラリIDと質問のドキュメントとコードスニペットをフェッチ。有効なライブラリIDを取得するため、最初にresolve-library-idを呼び出す必須。

## 使用時期

ユーザーが以下の場合にアクティベーション：

- セットアップまたは構成の質問（例：「Next.jsミドルウェアを構成する方法は？」）
- ライブラリに依存するコードをリクエスト（「Prismaクエリを書いて...」）
- APIまたはリファレンス情報が必要（「Supabase認証方法は何ですか？」）
- 特定のフレームワークまたはライブラリに言及（React、Vue、Svelte、Express、Tailwind、Prisma、Supabaseなど）

リクエストがライブラリ、フレームワーク、またはAPIの正確で最新の動作に依存するときはいつでもこのスキルを使用。Context7 MCPが構成されたハーネス全体に適用されます（例：Claude Code、Cursor、Codex）。

## 動作方法

### ステップ1：ライブラリIDを解決

**resolve-library-id** MCPツールを以下で呼び出す：

- **libraryName**：ユーザーの質問から取得したライブラリまたはプロダクト名（例：`Next.js`、`Prisma`、`Supabase`）。
- **query**：ユーザーの完全な質問。これにより結果の関連性ランキングが改善。

クエリドキュメントを呼び出す前に、Context7互換のライブラリID（形式`/org/project`または`/org/project/version`）を取得する必要があります。このステップから有効なライブラリIDなしでquery-docsを呼び出さないでください。

### ステップ2：最適なマッチを選択

解決結果から、以下を使用して1つの結果を選択：

- **名前マッチ**：ユーザーが尋ねたものに対する正確なまたは最も近いマッチを好む。
- **ベンチマークスコア**：より高いスコアはより良いドキュメント品質を示す（100は最高）。
- **ソース評判**：利用可能な場合はHigh またはMedium評判を好む。
- **バージョン**：ユーザーがバージョンを指定した場合（例：「React 19」、「Next.js 15」）、バージョン固有のライブラリIDを好む（例：`/org/project/v1.2.0`）。

### ステップ3：ドキュメントをフェッチ

**query-docs** MCPツールを以下で呼び出す：

- **libraryId**：ステップ2から選択したContext7ライブラリID（例：`/vercel/next.js`）。
- **query**：ユーザーの特定の質問またはタスク。関連スニペットを取得するために具体的にする。

制限：質問ごとにquery-docs（またはresolve-library-id）を3回以上呼び出さない。3回の呼び出し後も答えが不明確の場合は、不確実性を述べ、推測するのではなく最良の情報を使用。

### ステップ4：ドキュメントを使用

- フェッチされた現在の情報を使用してユーザーの質問に答える。
- 役立つ場合はドキュメントからの関連するコード例を含める。
- 重要な場合はライブラリまたはバージョンを引用（例：「Next.js 15では...」）。

## 例

### 例：Next.jsミドルウェア

1. `libraryName: "Next.js"`、`query: "Next.jsミドルウェアを設定する方法は？"`で**resolve-library-id**を呼び出す。
2. 結果から、名前とベンチマークスコアで最良のマッチ（例：`/vercel/next.js`）を選択。
3. `libraryId: "/vercel/next.js"`、`query: "Next.jsミドルウェアを設定する方法は？"`で**query-docs**を呼び出す。
4. 返されたスニペットとテキストを使用して答え、関連する場合はドキュメントの最小`middleware.ts`例を含める。

### 例：Prismaクエリ

1. `libraryName: "Prisma"`、`query: "関係を持つクエリ方法は？"`で**resolve-library-id**を呼び出す。
2. 公式Prismaライブラリ ID（例：`/prisma/prisma`）を選択。
3. その`libraryId`とクエリで**query-docs**を呼び出す。
4. Prisma Clientパターン（例：`include`または`select`）とドキュメントの短いコードスニペットを返す。
