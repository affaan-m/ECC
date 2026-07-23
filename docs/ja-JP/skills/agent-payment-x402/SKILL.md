---
name: agent-payment-x402
description: タスクごとのバジェット、支出コントロール、ノンカストディアルウォレットを備えた x402 決済実行を AI エージェントに追加します。agentwallet-sdk を通じて Base をサポートし、OKX Payments / OKX エージェント決済プロトコルを通じて X Layer をサポートします。
origin: community
---

# エージェント決済実行（x402）

ポリシーゲートによる決済と組み込みの支出コントロールで AI エージェントを有効化します。x402 HTTP 決済プロトコルと MCP ツールを使用して、カストディアルリスクなしに外部サービス、API、または他のエージェントへの支払いを行えます。

## 使用タイミング

使用する場合：エージェントが API 呼び出しへの支払い、サービスの購入、別のエージェントとの決済、タスクごとの支出制限の強制、またはノンカストディアルウォレットの管理を必要とする場合。`cost-aware-llm-pipeline` および `security-review` スキルと自然に組み合わせられます。

## 決定ツリー

エージェントが有料 API へのアクセスを購入するか、他者にアクセスを課金するかに基づいて統合パスを選択します：

| ニーズ | 推奨パス |
|------|------------------|
| エージェントが Base または他の agentwallet 対応チェーンの 402 ゲート API に支払う | 厳格な支出ポリシーで `agentwallet-sdk` を MCP 決済サーバーとして使用 |
| エージェントが X Layer の 402 ゲート API に支払う | `okx/onchainos-skills` の OKX エージェント決済プロトコルを使用；`okx-x402-payment` は廃止されたレガシーエイリアス |
| TypeScript API がエージェントに課金する | Express、Hono、Fastify、または Next.js 向け OKX Payments TypeScript セラー SDK ドキュメントを使用 |
| Go API がエージェントに課金する | Gin、Echo、または `net/http` 向け OKX Payments Go セラー SDK ドキュメントを使用 |
| Rust API がエージェントに課金する | Axum 向け OKX Payments Rust セラー SDK ドキュメントを使用 |
| Java API がエージェントに課金する | Spring Boot 2/3、Java EE、または Jakarta 向け OKX Payments Java セラー SDK ドキュメントを使用 |
| Python API がエージェントに課金する | 実装前に現在の OKX Payments リポジトリを確認；Python セラーガイドがない場合がある |

## 対応ネットワーク

- `agentwallet-sdk`: 本番使用前に現在のネットワークカバレッジをパッケージドキュメントで確認。Base Sepolia が最も安全な開発デフォルト；Base メインネットがオリジナルスキルで説明されている本番パス。
- OKX Payments / X Layer: 現在のセラードキュメントは X Layer（`eip155:196`）と USDT0 決済を対象。決済パッケージとファシリテーターの動作が迅速に変わる可能性があるため、本番コードを生成する前に現在の SDK ドキュメントを取得すること。

## 仕組み

### x402 プロトコル
x402 は HTTP 402（Payment Required）を機械が交渉可能なフローに拡張します。サーバーが `402` を返すと、エージェントの決済ツールが価格を交渉し、バジェットを確認し、トランザクションに署名し、オーケストレーターが設定したポリシーと確認境界内でのみリトライします。

### 支出コントロール
すべての決済ツール呼び出しは `SpendingPolicy` を強制します：
- **タスクごとのバジェット** — 単一エージェントアクションの最大支出
- **セッションごとのバジェット** — セッション全体の累積制限
- **許可リストに登録された受取人** — エージェントが支払える アドレス/サービスを制限
- **レート制限** — 分/時間あたりの最大トランザクション数

### ノンカストディアルウォレット
エージェントは ERC-4337 スマートアカウントを通じて独自のキーを保持します。オーケストレーターが委任前にポリシーを設定し、エージェントは境界内でのみ支出できます。プールされた資金なし、カストディアルリスクなし。

## MCP 統合

決済層は Claude Code またはエージェントハーネスのセットアップに組み込まれる標準 MCP ツールを公開します。

> **セキュリティ注意**: 常にパッケージバージョンを固定してください。このツールは秘密鍵を管理します — 固定されていない `npx` インストールはサプライチェーンリスクをもたらします。

### オプション A: agentwallet-sdk（Base / マルチチェーン）

```json
{
  "mcpServers": {
    "agentpay": {
      "command": "npx",
      "args": ["agentwallet-sdk@6.0.0"]
    }
  }
}
```

### 利用可能なツール（エージェント呼び出し可能）

| ツール | 目的 |
|------|---------|
| `get_balance` | エージェントウォレットの残高を確認 |
| `send_payment` | アドレスまたは ENS に支払いを送信 |
| `check_spending` | 残りバジェットを照会 |
| `list_transactions` | すべての支払いの監査証跡 |

> **注意**: 支出ポリシーはエージェントへの委任前に**オーケストレーター**が設定します — エージェント自体では設定しません。これによりエージェントが独自の支出制限をエスカレーションするのを防ぎます。オーケストレーション層またはタスク前のフックで `set_policy` 経由でポリシーを設定し、エージェント呼び出し可能ツールとしては設定しないこと。

### オプション B: OKX エージェント決済プロトコル（X Layer）

X Layer x402、マルチパーティ決済（MPP）、セッション決済、チャージ、A2A チャージフロー向けにこのパスを使用します。

バイヤー側エージェントフローの場合：

1. 現在の `okx/onchainos-skills` リポジトリをインストールまたは参照する。
2. `skills/okx-agent-payments-protocol/SKILL.md` をディスパッチャーとして使用する。
3. `skills/okx-x402-payment/SKILL.md` は廃止された互換エイリアスとして扱い、正規スキルとしては扱わない。
4. ウォレット状態の確認または決済アクションの前に明示的なユーザー確認を求める。汎用ツール呼び出しの背後に決済実行を隠さない。

セラー側 API フローの場合、コードを生成する前に最新の言語固有ガイドを取得する：

| ランタイム | 現在のガイド |
|---------|---------------|
| TypeScript | `https://raw.githubusercontent.com/okx/payments/main/typescript/SELLER.md` |
| Go | `https://raw.githubusercontent.com/okx/payments/main/go/x402/SELLER.md` |
| Rust | `https://raw.githubusercontent.com/okx/payments/main/rust/x402/SELLER.md` |
| Java | `https://raw.githubusercontent.com/okx/payments/main/java/SELLER.md` |

現在の OKX リポジトリを確認せずに古いドキュメントの例をコピーしないこと。現在の OKX ガイダンスはディスパッチャーとして `okx-agent-payments-protocol` を使用しており、Java セラードキュメントが利用可能になっています。

## 例

### MCP クライアントでのバジェット強制

有料ツール呼び出しをディスパッチする前にバジェットを強制するオーケストレーターを構築する場合。

> **前提条件**: MCP 設定を追加する前にパッケージをインストール — 非インタラクティブ環境では `-y` なしの `npx` は確認を求め、サーバーがハングします：`npm install -g agentwallet-sdk@6.0.0`

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  // 1. トランスポートを構築する前に認証情報を検証する。
  //    キーが欠落している場合は即座に失敗する — 認証なしでサブプロセスを開始させない。
  const walletKey = process.env.WALLET_PRIVATE_KEY;
  if (!walletKey) {
    throw new Error("WALLET_PRIVATE_KEY is not set — refusing to start payment server");
  }

  // stdio トランスポートを介して agentpay MCP サーバーに接続する。
  // サーバーが必要とする env 変数のみをホワイトリストに登録する —
  // 秘密鍵を管理するサードパーティのサブプロセスに process.env のすべてを渡さない。
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["agentwallet-sdk@6.0.0"],
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: process.env.NODE_ENV ?? "production",
      WALLET_PRIVATE_KEY: walletKey,
    },
  });
  const agentpay = new Client({ name: "orchestrator", version: "1.0.0" });
  await agentpay.connect(transport);

  // 2. エージェントへの委任前に支出ポリシーを設定する。
  //    常に成功を確認する — サイレントな失敗はコントロールがアクティブでないことを意味する。
  const policyResult = await agentpay.callTool({
    name: "set_policy",
    arguments: {
      per_task_budget: 0.50,
      per_session_budget: 5.00,
      allowlisted_recipients: ["api.example.com"],
    },
  });
  if (policyResult.isError) {
    throw new Error(
      `Failed to set spending policy — do not delegate: ${JSON.stringify(policyResult.content)}`
    );
  }

  // 3. 有料アクションの前に preToolCheck を使用する
  await preToolCheck(agentpay, 0.01);
}

// プレツールフック: 4 つの異なるエラーパスを持つフェイルクローズドバジェット強制。
async function preToolCheck(agentpay: Client, apiCost: number): Promise<void> {
  // パス 1: 無効な入力を拒否する（NaN/Infinity は < 比較をバイパスする）
  if (!Number.isFinite(apiCost) || apiCost < 0) {
    throw new Error(`Invalid apiCost: ${apiCost} — action blocked`);
  }

  // パス 2: トランスポート/接続の失敗
  let result;
  try {
    result = await agentpay.callTool({ name: "check_spending" });
  } catch (err) {
    throw new Error(`Payment service unreachable — action blocked: ${err}`);
  }

  // パス 3: ツールがエラーを返した（例：認証失敗、ウォレット未初期化）
  if (result.isError) {
    throw new Error(
      `check_spending failed — action blocked: ${JSON.stringify(result.content)}`
    );
  }

  // パス 4: レスポンスの形状を解析して検証する
  let remaining: number;
  try {
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    if (!Number.isFinite(parsed?.remaining)) {
      throw new TypeError("missing or non-finite 'remaining' field");
    }
    remaining = parsed.remaining;
  } catch (err) {
    throw new Error(
      `check_spending returned unexpected format — action blocked: ${err}`
    );
  }

  // パス 5: バジェット超過
  if (remaining < apiCost) {
    throw new Error(
      `Budget exceeded: need $${apiCost} but only $${remaining} remaining`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

## ベストプラクティス

- **委任前にバジェットを設定する**: サブエージェントを生成する際、オーケストレーション層を通じて SpendingPolicy を添付する。エージェントに無制限の支出を与えない。
- **依存関係を固定する**: MCP 設定に常に正確なバージョンを指定する（例：`agentwallet-sdk@6.0.0`）。本番デプロイ前にパッケージの整合性を確認する。
- **監査証跡**: タスク後のフックで `list_transactions` を使用して何が使われたかをログに記録する。
- **フェイルクローズド**: 決済ツールに到達できない場合、有料アクションをブロックする — 課金されないアクセスにフォールバックしない。
- **security-review と組み合わせる**: 決済ツールは高い権限を持つ。シェルアクセスと同じ精査を適用する。
- **まずテストネットでテストする**: 開発には Base Sepolia を使用；本番には Base メインネットに切り替える。

## 本番リファレンス

- **npm**: [`agentwallet-sdk`](https://www.npmjs.com/package/agentwallet-sdk)
- **NVIDIA NeMo エージェントツールキットにマージ**: [PR #17](https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples/pull/17) — NVIDIA のエージェント例向け x402 決済ツール
- **プロトコル仕様**: [x402.org](https://x402.org)
- **OKX Payments SDK**: [`okx/payments`](https://github.com/okx/payments) — X Layer x402 向け TypeScript、Go、Rust、Java セラー統合
- **OKX エージェント決済プロトコルスキル**: [`okx/onchainos-skills`](https://github.com/okx/onchainos-skills/tree/main/skills/okx-agent-payments-protocol)
- **OKX Payments 概要**: [web3.okx.com/onchainos/dev-docs/payments/overview](https://web3.okx.com/onchainos/dev-docs/payments/overview)
