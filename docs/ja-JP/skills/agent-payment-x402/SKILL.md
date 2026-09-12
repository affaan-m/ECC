---
name: agent-payment-x402
description: タスクごとのバジェット、支出コントロール、ノンカストディアルウォレットを備えた x402 決済実行を AI エージェントに追加します。agentwallet-sdk を通じて Base を、OKX Payments / OKX エージェント決済プロトコルを通じて X Layer を、アップストリームの x402 パッケージとファシリテーターベースの決済を通じて Solana とマルチネットワーク EVM をサポートします。
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
| エージェントが Solana または他の x402 v2 ネットワークの 402 ゲート API に支払う | エージェントの HTTP クライアントをアップストリームの `@x402/fetch` または `@x402/axios` パッケージでラップし、EVM/SVM スキームを登録する；リソースサーバーのファシリテーターが検証・決済する |
| API が Solana または複数ネットワークでエージェントに課金する（TypeScript、Python、または Go） | `x402-foundation/x402` のアップストリーム x402 ミドルウェアを使用 — TypeScript は `@x402/express`、`@x402/hono`、`@x402/next`、または `@x402/fastify`、Python は `x402`、Go は `github.com/x402-foundation/x402/go/v2` |
| TypeScript API がエージェントに課金する | Express、Hono、Fastify、または Next.js 向け OKX Payments TypeScript セラー SDK ドキュメントを使用 |
| Go API がエージェントに課金する | Gin、Echo、または `net/http` 向け OKX Payments Go セラー SDK ドキュメントを使用 |
| Rust API がエージェントに課金する | Axum 向け OKX Payments Rust セラー SDK ドキュメントを使用 |
| Java API がエージェントに課金する | Spring Boot 2/3、Java EE、または Jakarta 向け OKX Payments Java セラー SDK ドキュメントを使用 |
| Python API がエージェントに課金する | 実装前に現在の OKX Payments リポジトリを確認；Python セラーガイドがない場合がある |

## 対応ネットワーク

- `agentwallet-sdk`: 本番使用前に現在のネットワークカバレッジをパッケージドキュメントで確認。Base Sepolia が最も安全な開発デフォルト；Base メインネットがオリジナルスキルで説明されている本番パス。
- OKX Payments / X Layer: 現在のセラードキュメントは X Layer（`eip155:196`）と USDT0 決済を対象。決済パッケージとファシリテーターの動作が迅速に変わる可能性があるため、本番コードを生成する前に現在の SDK ドキュメントを取得すること。
- アップストリーム x402 パッケージ: 設計上マルチネットワーク — 1 つのルートで Base と Solana を同時に提示し、買い手に選ばせることができる。パッケージのデフォルトは `x402.org` ファシリテーターで、テストネット専用（Base Sepolia `eip155:84532`、Solana デブネット `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`、加えて Stellar、Aptos、Hedera、XRPL の各テストネット）であり、メインネットルート向けではない。メインネット（Solana は `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`）では、自己ファシリテートするか、自前のファシリテーターを運用するか、アップストリームのファシリテーターリストからホスト型を選ぶ — オプション C のファシリテーター比較を参照。本番前にここにハードコードするのではなく、ファシリテーターの `/supported` エンドポイントでライブカバレッジを確認すること。

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

### オプション C: アップストリーム x402 パッケージ（Solana + Base/EVM）

エージェントが Solana、Base、またはアップストリームのプロトコル実装がサポートする他のネットワークで支払う（または API が課金する）場合にこのパスを使用します。[`x402-foundation/x402`](https://github.com/x402-foundation/x402) の正規 x402 モノレポは活発にメンテナンスされており、クライアントとミドルウェアのパッケージを直接公開しています。オプション A・B と異なり、これは別個の MCP サーバーではありません — エージェント自身の HTTP クライアントをラップし、リソースサーバーが選んだファシリテーターが検証・決済します。

バイヤー側エージェントフローの場合：

1. 古いドキュメントのスニペットをコピーするのではなく、メンテナンスされている [`examples/typescript/clients`](https://github.com/x402-foundation/x402/tree/main/examples/typescript/clients)（fetch、axios、MCP）の例から始める。
2. オプション B が OKX フローに要求するのとまったく同様に、最初の有料リクエストの署名または送信の前に明示的なユーザー確認を求める。汎用ツール呼び出しの背後に決済実行を隠さない。
3. パッケージバージョンを固定する（例：`@x402/fetch@2.22.0`）；アップストリームの全パッケージはロックステップでバージョニングされる。
4. バジェットはクライアントに登録した `PaymentPolicy` で強制し、毎回サーバーの実際のチャレンジに対して検査が走るようにする。自分で渡した数値と突き合わせるバジェットは何も証明しない — 金額・アセット・ネットワークはすべてサーバー由来なので、署名が生成される前に 3 つとも検証すること。

```typescript
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";

// Signer keys belong to the ORCHESTRATOR's env — never hardcoded, never agent-writable.
const evmKey = process.env.EVM_PRIVATE_KEY as `0x${string}`;
const svmKey = process.env.SVM_PRIVATE_KEY;
if (!evmKey || !svmKey) {
  throw new Error("Signer keys are not set — refusing to start payment client");
}

// One client, both network families: the buyer pays whichever chain the 402 offers.
const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(privateKeyToAccount(evmKey)));
client.register("solana:*", new ExactSvmScheme(await createKeyPairSignerFromBytes(base58.decode(svmKey))));

// A PaymentPolicy filters the SERVER's payment requirements before any
// signature is created. Returning an empty array means "nothing here is
// acceptable" and the client refuses to pay rather than falling back.
const ALLOWED_NETWORKS = new Set([
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",      // Solana mainnet
  "eip155:8453",                                   // Base
]);
const MAX_AMOUNT = 10_000n;      // atomic units — 6-decimal USDC, so $0.01 per call
const SESSION_CAP = 50_000n;     // $0.05 across the whole session

// EVM addresses are case-insensitive, so compare them lowercased. Solana
// addresses are base58 and ARE case-sensitive — never lowercase those, or a
// different account could slip through.
const normalizeAddress = (a: string) => (a.startsWith("0x") ? a.toLowerCase() : a);
const ALLOWED_ASSETS = new Set(
  [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",  // USDC, Solana mainnet
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",    // USDC, Base
  ].map(normalizeAddress),
);
// Who you are willing to pay. Without this, any 402 an agent happens to hit
// can name its own recipient.
const ALLOWED_PAY_TO = new Set(
  ["7pr7NCaQRz5PEhPy7BAeB3Z72TVkiShhjRyVCN5DA6yC"].map(normalizeAddress),
);

client.registerPolicy((_x402Version, requirements) =>
  requirements.filter(r => {
    if (!ALLOWED_NETWORKS.has(r.network)) return false;                   // wrong chain
    if (!ALLOWED_ASSETS.has(normalizeAddress(r.asset))) return false;     // wrong token
    if (!ALLOWED_PAY_TO.has(normalizeAddress(r.payTo))) return false;     // wrong recipient
    try {
      const amount = BigInt(r.amount);
      return amount >= 0n && amount <= MAX_AMOUNT;                        // over budget / negative
    } catch {
      return false;                                                       // unparseable amount
    }
  }),
);

// The policy sees one challenge at a time, so it cannot enforce a session
// total or ask a human anything. Keep the payment-enabled client private and
// route every paid call through this boundary.
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Supply this from your harness — a real prompt, never a stub that returns true.
declare function confirmWithUser(prompt: string): Promise<boolean>;

let sessionSpent = 0n;
let sessionApproved = false;

async function payOnce(url: string, init?: RequestInit): Promise<Response> {
  // Reserve the worst case the policy allows. Settlement responses do not
  // carry an amount, so counting MAX_AMOUNT per call is a deliberate
  // over-estimate — it can stop early, never late.
  if (sessionSpent + MAX_AMOUNT > SESSION_CAP) {
    throw new Error("Session budget exhausted — blocked");
  }
  if (!sessionApproved) {
    sessionApproved = await confirmWithUser(
      `Allow paid requests up to ${SESSION_CAP} atomic units this session?`,
    );
    if (!sessionApproved) throw new Error("User declined — no payment attempted");
  }
  sessionSpent += MAX_AMOUNT;
  return fetchWithPayment(url, init);
}

const res = await payOnce("https://api.example.com/data", { method: "GET" });
```

ポリシーを登録すると、予算超過の金額、想定外のトークン、未登録のチェーンはすべてフェイルクローズドになる — 候補がすべて除外されるため、`createPaymentPayload` は署名せずに例外を投げる。デブネット USDC は `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`；開発時のみ `ALLOWED_ASSETS` に追加すること。ポリシーは敵対的にテストする — `5000000` アトミック単位を要求するチャレンジ、別のミントを提示するチャレンジ、登録していないチェーンのチャレンジを与え、いずれも署名が生成されないことを確認する。exact-SVM スキームではファシリテーターがトランザクション手数料支払者となるため、買い手のウォレットは USDC のみを保有すればよい — ガス用の SOL は不要。

**ファシリテーターの選択。** ファシリテーターはリソースサーバーに代わって検証と決済を行うため、これは買い手ではなくリソースサーバーの判断である。委ねる信頼が小さい順に：

| 選択肢 | 適する場面 |
|--------|--------------|
| [インプロセスで自己ファシリテート](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers/self-facilitation) | 決済経路に第三者を入れたくなく、鍵と RPC アクセスを自前で保持できる |
| 自前のファシリテーターを運用 | 同じ制御を複数サービスで共有したい |
| [`x402.org` ファシリテーター](https://x402.org/facilitator) | 開発・テストネット向け — パッケージのデフォルトでセットアップ不要。アップストリームはメインネットルート向けではないと明記している |
| ホスト型の本番ファシリテーター | インフラを運用せずにメインネット対応が欲しい |

ホスト型を選ぶ場合は、ここに書かれた名前ではなくアップストリームドキュメントの[ファシリテーターリスト](https://docs.x402.org/dev-tools/facilitators)から選ぶこと — メンテナンスされており、網羅的ではなく、カバレッジも変わる。執筆時点では Coinbase の CDP（全トランザクションに KYT/OFAC スクリーニング）、PayAI、Corbits、Dexter、Solvador などが掲載され、複数が EVM に加えて Solana メインネットをカバーしている。どれを選ぶ場合も、本番前に `/supported` エンドポイントでライブカバレッジを確認し、ネットワークを追加したときは再確認すること。

> **開示**: このセクションは、掲載されているファシリテーターの 1 つである PayAI に関わる者が寄稿した。複数ある選択肢の 1 つとして記載しており、上記の自己ホストおよびアップストリームデフォルトのパスを意図的に先に挙げている。

**セラー側（API がエージェントに課金する）。** アップストリームのミドルウェアを使用する；1 つのルートで Base と Solana を同時に提示できる（実行可能なバージョンは [`examples/typescript/servers`](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers) を参照）：

| ランタイム | パッケージ |
|---------|---------|
| Express / Hono / Next.js / Fastify | `@x402/express@2.22.0`、`@x402/hono@2.22.0`、`@x402/next@2.22.0`、`@x402/fastify@2.22.0` |
| Python（FastAPI、Flask） | PyPI の `x402` |
| Go（Gin、Echo、`net/http`） | `github.com/x402-foundation/x402/go/v2` |

**Solana のセラー：`payTo` アドレスには先に正規のトークンアカウントが必要。** exact-SVM クライアントは `findAssociatedTokenPda` で `payTo` の*関連トークンアカウント*（ATA）を導出してそこに送金するが、それを作成はしない。その正確なアカウントが存在しないと決済はシミュレーション段階で失敗し、402 が `transaction_simulation_failed` を返す — クライアントのバグのように見えるが、実際は受取側アカウントの欠落である。導出したアドレス自体を確認すること — オーナーのトークンアカウントを走査するのは等価ではない。同じミントの非正規な補助アカウントがあると検査は通るのに、クライアントが対象とする ATA は依然として存在しないからだ：

```typescript
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

const [ata] = await findAssociatedTokenPda({
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",   // USDC mainnet
  owner: payToAddress,
  tokenProgram: TOKEN_PROGRAM_ADDRESS,                     // TOKEN_2022_PROGRAM_ADDRESS for Token-2022 mints
});
```

次にそのアドレスが実在することを確認する — `value: null` なら存在せず、そこへの決済は失敗する：

```bash
curl -s https://api.mainnet-beta.solana.com -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo",
       "params":["<DERIVED_ATA>",{"encoding":"base64"}]}' \
  | jq '.result.value != null'
```

作成方法（作成者が少額のレントを負担し、支払者ではない）：

- コード上では `@solana-program/token` の `getCreateAssociatedTokenIdempotentInstruction` をオンボーディングフローに追加する — 冪等版なので再実行しても安全で、決定的に動作する唯一の方法。
- spl-token CLI で `spl-token create-account <MINT> --owner <PAYTO_ADDRESS>`。
- そのトークンを `payTo` に送金する方法も使えるが、送金側が作成インストラクションを含む場合に限る — ウォレットや `spl-token transfer --fund-recipient` は含める。ATA が無い状態への素の `transferChecked` は、決済と同じように失敗する。

これは新規プロビジョニングされたウォレットやカストディアルウォレットへの支払いで最も問題になりやすい。そうしたウォレットは対象アセットの ATA をまだ持っていないことが多い。

**発見。** x402 バザール拡張を実装するファシリテーターは `/discovery/resources` エンドポイントを公開する — CDP カタログは `https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`、PayAI カタログは `https://facilitator.payai.network/discovery/resources` で照会できる。Solana で支払い可能なサービスには、Solana Foundation のキュレーションカタログである [pay.sh](https://pay.sh) もある。

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
- **まずテストネットでテストする**: 開発には Base Sepolia を使用；本番には Base メインネットに切り替える。Solana では、メインネットの本番ファシリテーターに移る前に、Solana デブネット（`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`）と無料の x402.org ファシリテーターで開発する。
- **Solana では SOL ではなく USDC を資金として入れる**: exact-SVM スキームではファシリテーターがトランザクション手数料支払者となるため、SOL を持たないウォレットでも支払える。署名前に各チャレンジの `asset` を期待する USDC ミント（メインネット `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`、デブネット `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`）と照合する — 任意のアセットに支払うラップクライアントはバジェットの穴になる。

## 本番リファレンス

- **npm**: [`agentwallet-sdk`](https://www.npmjs.com/package/agentwallet-sdk)
- **NVIDIA NeMo エージェントツールキットにマージ**: [PR #17](https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples/pull/17) — NVIDIA のエージェント例向け x402 決済ツール
- **プロトコル仕様**: [x402.org](https://x402.org)
- **OKX Payments SDK**: [`okx/payments`](https://github.com/okx/payments) — X Layer x402 向け TypeScript、Go、Rust、Java セラー統合
- **OKX エージェント決済プロトコルスキル**: [`okx/onchainos-skills`](https://github.com/okx/onchainos-skills/tree/main/skills/okx-agent-payments-protocol)
- **OKX Payments 概要**: [web3.okx.com/onchainos/dev-docs/payments/overview](https://web3.okx.com/onchainos/dev-docs/payments/overview)
- **アップストリーム x402 モノレポ**: [`x402-foundation/x402`](https://github.com/x402-foundation/x402) — TypeScript、Python、Go の実装と、メンテナンスされているクライアント・サーバー例
- **x402 ドキュメント**: [docs.x402.org](https://docs.x402.org)；本番ファシリテーターリストは [docs.x402.org/dev-tools/facilitators](https://docs.x402.org/dev-tools/facilitators)
- **`@x402` パッケージ**: [npmjs.com/org/x402](https://www.npmjs.com/org/x402) — `@x402/fetch`、`@x402/axios`、`@x402/express`、`@x402/hono`、`@x402/next`、`@x402/fastify`、`@x402/evm`、`@x402/svm`
- **ファシリテーター**: [自己ファシリテーションの例](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers/self-facilitation)（第三者なし）、[x402.org ファシリテーター](https://x402.org/facilitator)（テストネットデフォルト）、メンテナンスされている[本番リスト](https://docs.x402.org/dev-tools/facilitators)
- **発見**: CDP と PayAI のバザールは `/discovery/resources`；Solana で支払い可能なサービスは [pay.sh](https://pay.sh)
