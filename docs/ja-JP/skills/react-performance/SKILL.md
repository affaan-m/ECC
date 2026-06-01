---
name: react-performance
description: Vercel Engineering の React Best Practices（https://github.com/vercel-labs/agent-skills）から採用した React と Next.js のパフォーマンス最適化パターン。ウォーターフォール、バンドルサイズ、サーバーサイド、クライアントフェッチ、再レンダリング、レンダリング、JS マイクロパフォーマンス、高度なパターンの 8 優先カテゴリーにわたる 70 以上のルールを整理する。React/Next.js のコードをパフォーマンス観点で実装、レビュー、リファクタリングする際に使用する。
origin: ECC
---

# React パフォーマンス

React 18/19 と Next.js のパフォーマンス最適化パターン。[Vercel Labs `react-best-practices`](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices)（MIT、v1.0.0）から採用。このスキルはルールを優先度別に整理し、アクティブなコードレビューとリファクタリングのための決定木ガイダンスを提供する。

## 有効化するタイミング

- パフォーマンスを意識した React/Next.js コードの実装またはレビュー時
- ページロードの遅さ、インタラクションの遅さ、クライアントでの高 CPU を診断する時
- バンドルサイズや Lighthouse Core Web Vitals のリグレッションを監査する時
- Server Components / API ルートのウォーターフォールを除去する時
- クライアント側の再レンダリングを削減する時
- 長いリスト、アニメーション、またはハイドレーションを最適化する時
- `app/`、`pages/`、`components/`、またはデータレイヤーに触れる PR の最適化選択を監査する時

## 優先度インデックス

| 優先度 | カテゴリー | プレフィックス | 重要になる場面 |
|---|---|---|---|
| 1 — 重大 | ウォーターフォールの排除 | `async-` | 独立した `await` に続く `await` がある場合 |
| 2 — 重大 | バンドルサイズ最適化 | `bundle-` | ファーストロード JS、ルートレベルインポート、サードパーティライブラリ |
| 3 — 高 | サーバーサイドパフォーマンス | `server-` | RSC、Server Actions、API ルート、SSR |
| 4 — 中高 | クライアント側データフェッチ | `client-` | SWR / TanStack Query / フック内の生 `fetch` |
| 5 — 中 | 再レンダリング最適化 | `rerender-` | 高頻度の state 更新、親子ファンアウト |
| 6 — 中 | レンダリングパフォーマンス | `rendering-` | 長いリスト、アニメーション、ハイドレーション |
| 7 — 低中 | JavaScript パフォーマンス | `js-` | ホットループ、頻繁なアロケーション |
| 8 — 低 | 高度なパターン | `advanced-` | エフェクトイベント統合、安定した ref |

## 1. ウォーターフォールの排除（重大）

> 「ウォーターフォールは #1 のパフォーマンスキラー」 — 逐次的な `await` はすべて完全なネットワークレイテンシーを加算する。

### 安価な条件を await より先に確認する

リモートデータを await する前に同期条件（プロップ、環境変数、ハードコードされたフラグ）を確認する。

```ts
// 誤り
async function Page({ id }: { id: string }) {
  const flag = await getFlag("show-page");
  if (!flag || !id) return null;
  const data = await getData(id);
  // ...
}

// 正しい — 安価な同期条件で先にショートサーキット
async function Page({ id }: { id: string }) {
  if (!id) return null;
  const flag = await getFlag("show-page");
  if (!flag) return null;
  const data = await getData(id);
}
```

### await を使用時まで遅らせる

`await` を使用するブランチの中に移動する。

```ts
// 誤り — データが必要かどうか決める前に await する
const user = await getUser(id);
if (mode === "guest") return renderGuest();
return renderUser(user);

// 正しい
if (mode === "guest") return renderGuest();
const user = await getUser(id);
return renderUser(user);
```

### 独立した処理に Promise.all を使用する

```ts
// 誤り — 逐次的
const user = await getUser(id);
const posts = await getPosts(id);
const followers = await getFollowers(id);

// 正しい — 並列
const [user, posts, followers] = await Promise.all([
  getUser(id),
  getPosts(id),
  getFollowers(id),
]);
```

### 部分的な依存関係 — 早期に開始し、遅く await する

```ts
// 正しい — すべての Promise を開始し、各結果が必要な時だけ await する
const userP = getUser(id);
const postsP = getPosts(id);
const profile = await getProfile(id);
if (profile.private) return null;
const [user, posts] = await Promise.all([userP, postsP]);
```

### ストリーミングに Suspense を使用する

`<Suspense>` 境界をデータの近くに配置して、遅いサブツリーがストリームインする間にページが描画できるものを描画できるようにする。トレードオフ: コンテンツ到着時のレイアウトシフト — スペースを確保する（スケルトンまたは `min-height`）。

### Server Components: コンポジションによる並列化

```tsx
// 誤り — 1 つのコンポーネント内の兄弟 await は逐次実行される
export default async function Page() {
  const user = await getUser();
  const cart = await getCart();
  return <View user={user} cart={cart} />;
}

// 正しい — 子に分割、React が並列実行する
export default async function Page() {
  return (
    <View>
      <UserSection />
      <CartSection />
    </View>
  );
}
```

## 2. バンドルサイズ最適化（重大）

### バレルではなく直接インポート

バレル `index.ts` ファイルはツリーシェイキングで大部分が削除される場合でもバンドラーにモジュールグラフ全体を走査させる。直接インポートにより多くの実世界アプリで 200〜800ms のファーストロード JS を削減できる。

```ts
// 誤り
import { Button, Card, Modal } from "@/components";

// 正しい
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Modal } from "@/components/Modal";
```

Next.js 13.5+ にはリストされたパッケージに対してこれを自動化する [Optimize Package Imports](https://nextjs.org/docs/app/api-reference/next-config-js/optimizePackageImports) がある — 使用すること; リスト外のライブラリには手動の直接インポートが引き続き必要。

### 静的に解析可能なパス

```ts
// 誤り — バンドラー/トレース解析を妨げる
const mod = await import(`./pages/${name}`);

// 正しい — ブランチごとに明示的
const mod = name === "home" ? await import("./pages/home") : await import("./pages/about");
```

### 重いコンポーネントへの動的インポート

```tsx
import dynamic from "next/dynamic";

const HeavyChart = dynamic(() => import("./HeavyChart"), {
  loading: () => <Skeleton />,
  ssr: false, // クライアント専用の場合
});
```

### サードパーティスクリプトの遅延

分析、ログ、サポートウィジェットはハイドレーション後にロードする。`next/script` を `strategy="afterInteractive"`（デフォルト）または `"lazyOnload"` で使用する。

### 条件付きモジュールロード

```tsx
if (user.role === "admin") {
  const { AdminPanel } = await import("./admin/AdminPanel");
  // ...
}
```

### ホバー/フォーカス時にプリロード

ホバー時に `<link rel="preload">` または `import()` をトリガーして、ユーザーがクリックするまでにバンドルをキャッシュに入れる。

## 3. サーバーサイドパフォーマンス（高）

### Server Actions を API ルートと同様に認証する

すべての `"use server"` 関数はパブリックエンドポイント。アクション内で認証と認可の両方を行う — 呼び出し側の Client Component のゲーティングに依存しない。

```ts
"use server";
export async function deleteUser(formData: FormData) {
  const session = await getSession();
  if (!session?.user) throw new Error("Unauthorized");
  const targetId = String(formData.get("id"));
  if (session.user.role !== "admin" && session.user.id !== targetId) {
    throw new Error("Forbidden");
  }
  await db.user.delete({ where: { id: targetId } });
}
```

### リクエストごとの重複排除に `React.cache()` を使用する

```ts
import { cache } from "react";

export const getUser = cache(async (id: string) => {
  return db.user.findUnique({ where: { id } });
});
```

`React.cache` は 1 つのリクエスト内で重複を排除する。同一レンダリング内の 3 つの Server Component から `getUser("1")` を呼び出すと DB クエリは 1 回のみ。

### クロスリクエストデータに LRU キャッシュを使用する

リクエストごとに変化しないデータ（設定、ルックアップテーブル）には、LRU キャッシュまたは `unstable_cache` を使用して React の外でキャッシュする。

### RSC プロップでの重複シリアライゼーションを避ける

Server Component が同じデータを複数の Client Component にレンダリングする場合、データはコンシューマーごとに 1 回シリアライズされる。Client Component を上にリフトして children を渡す。

### 静的 I/O をモジュールスコープにホイストする

```ts
// 正しい — モジュールロード時に 1 回実行される
const fontData = readFileSync(fontPath);

export async function Page() {
  return <Banner font={fontData} />;
}
```

### RSC/SSR でモジュールレベルのミュータブルな state を使わない

サーバー上のモジュール state はすべてのリクエスト間で共有される — ユーザー間の競合状態。代わりにリクエストスコープのストレージ（`headers()`、`cookies()`、非同期コンテキスト）を使用する。

### Client Components に渡すデータを最小化する

クライアントが必要とするものだけをシリアライズする。DB 層でフィールドの削除、ページネーション、カラムの射影を行う。

### Promise.all でネストされたフェッチを並列化する

```ts
const users = await getUsers();
const enriched = await Promise.all(
  users.map(async (u) => ({ ...u, posts: await getPostsFor(u.id) })),
);
```

### ノンブロッキング処理に `after()` を使用する

Next.js 15 の `after()` はレスポンスの送信後に処理を実行する — ログ、キャッシュウォーミング、分析。

```ts
import { after } from "next/server";
export async function GET() {
  const data = await getData();
  after(() => logAnalytics(data));
  return Response.json(data);
}
```

## 4. クライアント側データフェッチ（中高）

### 重複排除に SWR / TanStack Query を使用する

複数のコンポーネントが `useUser(id)` を呼び出す場合、1 つのネットワークリクエストと 1 つのキャッシュエントリーを共有すべき。SWR または TanStack Query を使用する — 共有データに自前の `useEffect` + `fetch` を絶対に使わない。

### グローバルイベントリスナーを重複排除する

```tsx
// 誤り — コンポーネントごとに独自のリスナーを追加する
useEffect(() => {
  window.addEventListener("scroll", handler);
  return () => window.removeEventListener("scroll", handler);
}, []);

// 正しい — フック + グローバルサブジェクト経由の単一共有リスナー
const useScroll = createScrollHook(); // 内部でシングルトンサブジェクト
```

### スクロールにパッシブリスナーを使用する

```ts
window.addEventListener("scroll", handler, { passive: true });
```

スクロールの滑らかさが向上する; リスナーは `preventDefault()` できない。

### localStorage: バージョン管理 + 最小化

- 常に `version` フィールドを保存する; スキーマ変更時にバンプし、古いデータをマイグレーションまたは破棄する
- ペイロードを小さく保つ — `localStorage` は同期 API でメインスレッドをブロックする

## 5. 再レンダリング最適化（中）

### コールバックでのみ使用する state をサブスクライブしない

```tsx
// 誤り — count が変わるたびに再レンダリングされる
const count = useStore((s) => s.count);
const handler = () => doSomething(count);

// 正しい — 呼び出し時に 1 度読む
const handler = () => {
  const count = useStore.getState().count;
  doSomething(count);
};
```

### 高コストな処理をメモ化されたコンポーネントに切り出す

```tsx
// 正しい — `items` が変わった場合にのみ子が再レンダリングされる
const Heavy = memo(function Heavy({ items }: { items: Item[] }) {
  return <Chart data={transform(items)} />;
});
```

### デフォルトの非プリミティブプロップをホイストする

```tsx
// 誤り — レンダリングごとに新しい配列が memo を壊す
<List items={items ?? []} />

// 正しい
const EMPTY: Item[] = [];
<List items={items ?? EMPTY} />
```

### エフェクトにプリミティブな依存関係を使用する

```tsx
// 誤り — レンダリングごとに新しいオブジェクトのアイデンティティ
useEffect(() => {}, [{ id, name }]);

// 正しい — プリミティブ
useEffect(() => {}, [id, name]);
```

### 生の値ではなく派生した真偽値をサブスクライブする

```tsx
// 誤り — カートのあらゆる変更で再レンダリングされる
const cart = useStore((s) => s.cart);
const hasItems = cart.length > 0;

// 正しい — 空かどうかが変わった場合のみ再レンダリングされる
const hasItems = useStore((s) => s.cart.length > 0);
```

### `useEffect` ではなくレンダリング中に派生させる

```tsx
// 誤り
const [full, setFull] = useState("");
useEffect(() => setFull(`${first} ${last}`), [first, last]);

// 正しい
const full = `${first} ${last}`;
```

### 安定したコールバックのために関数型 `setState` を使用する

```tsx
// 正しい
const increment = useCallback(() => setCount((c) => c + 1), []);
```

### 高コストな値に遅延 state 初期化を使用する

```tsx
const [tree] = useState(() => parseTree(largeInput));
```

### 単純なプリミティブに memo を使わない

`useMemo(() => x + 1, [x])` はオーバーヘッド。Memo はオブジェクトのアイデンティティと高コストな計算で真価を発揮する。

### 独立した依存関係を持つフックを分割する

```tsx
// 誤り — どちらかのソースが変わると両方のセレクターが再実行される
const { a, b } = useSomething(source1, source2);

// 正しい
const a = useA(source1);
const b = useB(source2);
```

### インタラクションロジックをイベントハンドラーに移動する

イベントハンドラーはユーザーのアクション時のみ実行される — `useEffect` は依存関係が変わるたびに再実行される。

### 緊急でない更新に `startTransition` を使用する

```tsx
const [pending, startTransition] = useTransition();
startTransition(() => setFilters(newFilters));
```

### 高コストなレンダリングに `useDeferredValue` を使用する

```tsx
const deferredQuery = useDeferredValue(query);
const results = useMemo(() => expensiveSearch(deferredQuery), [deferredQuery]);
```

### 頻繁に変化する一時的な値に `useRef` を使用する

再レンダリングをトリガーしてはいけない頻繁に変化する値（タイムスタンプ、最後のキー、アキュムレーター）に使用する。

### コンポーネント内でコンポーネントを定義しない

```tsx
// 誤り — Inner は Outer のレンダリングごとに新しいコンポーネントになる
function Outer() {
  const Inner = () => <span />;
  return <Inner />;
}
```

レンダリングごとに新しい `Inner` 型が作られ、リコンシリエーションを妨げ子のアンマウントを引き起こす。

## 6. レンダリングパフォーマンス（中）

### SVG ではなくラッパーをアニメーションさせる

SVG の周りの `<div>` ラッパーを変換する処理は GPU アクセラレーションされる; SVG 自体を変換するとペイントがトリガーされる。

### 長いリストに `content-visibility: auto` を使用する

```css
.row { content-visibility: auto; contain-intrinsic-size: auto 80px; }
```

ブラウザがオフスクリーンのレンダリングをスキップする — 数百行のリストで大きな効果がある。

### 静的 JSX をホイストする

```tsx
const STATIC_HEADER = <h1>Title</h1>;
function Page() {
  return <>{STATIC_HEADER}<Body /></>;
}
```

### SVG: 座標の精度を落とす

`d="M10.123456,20.654321"` → `d="M10.12,20.65"`。桁数はバイトコストになる; 視覚的な差は サブピクセル。

### インラインスクリプトによるハイドレーションのちらつき防止

ハイドレーション前に必要な値（theme、locale）には、React がマウントされる前に `document.documentElement.dataset.*` を設定する `<script>` をインラインで記述する。

### 既知のハイドレーションの不一致を局所的に抑制する

```tsx
<time suppressHydrationWarning>{new Date().toLocaleString()}</time>
```

既知の差異が生じるリーフノードにのみ使用する — 他の子を含むツリーには絶対に使わない。

### マウント/アンマウントの代わりに表示/非表示に `<Activity>` を使用する

React 19 の `<Activity mode="visible|hidden">` はツリーの state とエフェクトをマウントしたまま非表示にする — タブやアコーディオンのアンマウント/リマウントより低コスト。

### 条件付きレンダリングに `&&` ではなく三項演算子を使用する

```tsx
// 誤り — `0` がテキストノードとしてレンダリングされる
{count && <Badge>{count}</Badge>}

// 正しい
{count > 0 ? <Badge>{count}</Badge> : null}
```

### ローディング状態に `useTransition` を使用する

`startTransition` をアクションとペアにする; React は次の state が計算される間 `isPending` として前の UI を表示する。

### React DOM リソースヒント

```tsx
import { preload, preconnect } from "react-dom";
preload("/api/critical", { as: "fetch" });
preconnect("https://api.example.com");
```

### `<script>` タグへの `defer` / `async`

`defer` は DOMContentLoaded 後の順序付き実行; `async` はファイアアンドフォーゲット。

## 7. JavaScript パフォーマンス（低中）

- **DOM/CSS 変更のバッチ処理** — プロパティごとではなくクラスのスワップまたは `cssText` で適用する
- **繰り返しのルックアップに `Map` を使用** — `O(1)` vs `O(n)` の線形スキャン
- **ループ内でプロパティアクセスをキャッシュ** — `const len = arr.length`
- **純粋関数をメモ化** — モジュールレベルの `Map<key, result>`
- **`localStorage` の読み取りをキャッシュ** — 同期 API; レンダリングごとに 1 回読む
- **`filter().map()` を 1 回のパスに結合** — `flatMap` または単一の `for`
- **高コストな比較の前に配列の長さを確認**
- **関数からの早期リターン**
- **ループの外に RegExp をホイスト** — コンパイルはコストがかかる
- **最小/最大値には `sort()` ではなくループを使用** — `O(n)` vs `O(n log n)`
- **メンバーシップには `Set`/`Map` を使用** — `O(1)` vs `Array.includes` の `O(n)`
- **イミュータビリティが重要な場合は `toSorted()` を使用**（ミューテーションを避ける）
- **1 回のパスでマップとフィルタリングに `flatMap` を使用**
- **非クリティカルな処理に `requestIdleCallback` を使用**

## 8. 高度なパターン（低）

### `useEffectEvent` の依存関係

`useEffectEvent` からの値は安定している — エフェクトの依存関係に追加しない。

### イベントハンドラー ref

メモ化された子に渡す安定したコールバックのために:

```tsx
const handlerRef = useRef(handler);
useEffect(() => { handlerRef.current = handler; });
const stable = useCallback((arg) => handlerRef.current(arg), []);
```

### アプリロードごとに 1 回初期化する

モジュールレベルのシングルトン（テレメトリー、ロガー）にはモジュールスコープのフラグでガードする — `useEffect` ではなく。

### 安定したコールバック ref のための `useLatest`

```tsx
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
```

## 自動化ツール

これらのルールの多くは現在自動化されている:

- **Next.js 13.5+ Optimize Package Imports** — バレルインポート最適化
- **React Compiler**（RFC、カナリー版） — 自動メモ化
- **Turbopack** — 高速なビルド、より良いツリーシェイキング
- **Bundle Analyzer**（`@next/bundle-analyzer`）— ファーストロード JS の可視化

プロジェクトが React Compiler を採用した場合、`rerender-*` の手動メモ化ルールを「レビューのみ」に格下げする — コンパイラーが処理する。手動の `useMemo`/`useCallback` は不要なノイズになる。

## Lighthouse / Web Vitals のマッピング

| メトリクス | 最も関連するカテゴリー |
|---|---|
| **LCP**（Largest Contentful Paint） | ウォーターフォール、バンドルサイズ、リソースヒント |
| **INP**（Interaction to Next Paint） | 再レンダリング、レンダリング、JavaScript |
| **CLS**（Cumulative Layout Shift） | レンダリング（Suspense の配置、画像サイズ） |
| **TBT**（Total Blocking Time） | バンドルサイズ、JavaScript、サードパーティの遅延 |
| **FID**（レガシー） | バンドルサイズ、ハイドレーション |

## 関連

- スキル: [react-patterns](../react-patterns/SKILL.md)、[react-testing](../react-testing/SKILL.md)、[frontend-patterns](../frontend-patterns/SKILL.md)、[accessibility](../accessibility/SKILL.md)、[nextjs-turbopack](../nextjs-turbopack/SKILL.md)
- ルール: [rules/react/](../../rules/react/)
- エージェント: `react-reviewer` がコードレビューでこれらのルールを適用; `react-build-resolver` が関連するビルド失敗を処理する
- コマンド: `/react-review`、`/react-build`、`/react-test`

## 帰属

Vercel Labs `react-best-practices` スキル（MIT ライセンス、copyright Vercel Engineering、v1.0.0 January 2026）から採用。ソース: [https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices)。

このスキルは元の 70 ルールのカタログを 1 つのナビゲート可能なリファレンスに再構築・採用したもの。拡張された例を含む完全なオリジナルのルールセットについては上流リポジトリを参照。
