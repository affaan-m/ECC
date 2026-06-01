---
name: react-patterns
description: React 18/19 のパターン。フックの規律、サーバー/クライアントコンポーネント境界、Suspense + エラー境界、フォームアクション、データフェッチ、状態管理の決定木、アクセシビリティファーストのコンポジションを含む。React コンポーネントの実装またはレビュー時に使用する。
origin: ECC
---

# React パターン

堅牢でアクセシブルかつパフォーマンスの高いコンポーネントツリーを構築するための、React 18/19 の慣用的なパターン。

## 有効化するタイミング

- React 関数コンポーネント、カスタムフック、またはコンポーネントツリーの作成・変更時
- JSX/TSX ファイルのレビュー時
- state の形状やコンポーネントのコンポジションを設計する時
- クラスコンポーネントや古い `forwardRef`/`useEffect` 多用コードをマイグレーションする時
- ローカル state、リフトされた state、Context、外部ストアの選択時
- Server Components / Client Components（Next.js App Router、RSC）を扱う時
- React 19 アクションまたは制御入力でフォームを実装する時
- TanStack Query / SWR / RSC でデータフェッチを接続する時

## コア原則

### 1. レンダーはプロップと State の純粋関数

```tsx
// 良い例: レンダリング中に派生させる
function Cart({ items }: { items: CartItem[] }) {
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  return <span>{formatMoney(total)}</span>;
}

// 悪い例: 派生 state を別途保持する
function Cart({ items }: { items: CartItem[] }) {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    setTotal(items.reduce((sum, i) => sum + i.price * i.qty, 0));
  }, [items]);
  return <span>{formatMoney(total)}</span>;
}
```

`useEffect` での派生 state はレンダーサイクルを追加し、デシンクが発生する可能性があり、データフローを不明瞭にする。

### 2. 副作用はレンダーの外で

エフェクト、ミューテーション、ネットワーク呼び出し、サブスクリプションはイベントハンドラーまたは `useEffect` に置く — レンダー本体には置かない。

### 3. 継承よりコンポジション

React にはコンポーネントの継承モデルがない。`children`、レンダープロップ、またはコンポーネントプロップでコンポジションする。

## フックの規律

完全なルールセットは [rules/react/hooks.md](../../rules/react/hooks.md) を参照。ハイライト:

- トップレベルのみ、条件付きは禁止
- すべてのサブスクリプション、インターバル、リスナーをクリーンアップする
- 新しい state が古いものに依存する場合は関数型アップデーター（`setX(prev => prev + 1)`）
- デフォルトの立場: メモ化しない — プロファイラーや依存チェーンで必要が証明された場合にのみ `useMemo`/`useCallback` を追加する
- 同じフックシーケンスが 2 つ以上のコンポーネントに現れる場合にのみカスタムフックを切り出す

## State の配置決定木

```
1 つのコンポーネントのみで使用?
  -> その中の useState

親と少数の子孫で使用?
  -> 最も近い共通祖先にリフトする

距離の離れたブランチ全体で使用 かつ 低頻度の読み取り（theme、auth、locale）?
  -> React Context

ツリー全体で共有される高頻度の更新?
  -> 外部ストア（Zustand、Jotai、Redux Toolkit）

サーバーから派生?
  -> サーバー state ライブラリ（TanStack Query、SWR、RSC fetch）
```

ほとんどのページで Context やグローバルストアは不要。リフトの重複が苦痛になるまで抽象化を我慢する。

## サーバー / クライアントコンポーネント（RSC）

```tsx
// Server Component - デフォルト、非同期、JS を自身のためにクライアントに送らない
export default async function ProductPage({ params }: { params: { id: string } }) {
  const product = await db.product.findUnique({ where: { id: params.id } });
  if (!product) notFound();
  return <ProductView product={product} />;
}

// Client Component - "use client" でオプトイン
"use client";
export function AddToCartButton({ productId }: { productId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => addToCart(productId))}
    >
      {pending ? "Adding..." : "Add to cart"}
    </button>
  );
}
```

境界:

- Server -> Client: シリアライズ可能なプロップまたは `children` を渡す
- Client -> Server: `<form action={...}>` 経由またはイベントハンドラーから命令的に Server Actions を呼び出す
- Client Component ファイルから Server Component を `import` しない — 代わりに `children` でコンポジションする

## Suspense + エラー境界

```tsx
<ErrorBoundary fallback={<ErrorView />}>
  <Suspense fallback={<UserSkeleton />}>
    <UserDetail id={id} />
  </Suspense>
</ErrorBoundary>
```

- Suspense 境界はルートルートではなくデータの近くに配置する — コンテンツを段階的に表示する
- エラー境界はクラス API のまま; フックフレンドリーなラッパーには `react-error-boundary` を使用する
- 境界はレンダー、ライフサイクル、子のコンストラクター中にスローされたエラーをキャッチする — イベントハンドラーや非同期コードは対象外

## フォーム

### React 19 フォームアクション（新規コードで推奨）

```tsx
"use client";
import { useActionState } from "react";

const initial = { error: null as string | null };

async function updateUserAction(_prev: typeof initial, formData: FormData) {
  "use server";
  const parsed = UserSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid input" };
  await db.user.update({ where: { id: parsed.data.id }, data: parsed.data });
  return { error: null };
}

export function UserForm() {
  const [state, formAction, pending] = useActionState(updateUserAction, initial);
  return (
    <form action={formAction}>
      <input name="name" required />
      <button type="submit" disabled={pending}>Save</button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
```

### 制御入力

値が他の UI を駆動する場合、キーストロークごとにフォーマットする場合、またはリアルタイムバリデーションを実装する場合に制御入力を使用する。

### 複雑なフォーム

マルチステップフォーム、動的フィールド配列、クロスフィールドバリデーションには: ライブラリを使用する（React Hook Form、TanStack Form）。自前の state 管理を些末な複雑さを超えて作り込むと保守の罠になる。

## データフェッチ決定マトリクス

| 必要なもの | ツール |
|---|---|
| Next.js App Router でのリクエストごとのデータ | RSC `await fetch()` |
| クライアント側キャッシュ + ミューテーション + 無効化 | TanStack Query |
| 軽量なクライアントキャッシュ + 再検証 | SWR |
| リアルタイムサブスクリプション | Server-Sent Events、WebSockets、またはライブラリのサブスクリプション API |
| 1 回限りのファイアアンドフォーゲット | イベントハンドラー内の `fetch()` |

アプリケーションデータに `useEffect` + `fetch` を使わない — 競合状態、キャッシュなし、リトライなし、Suspense 統合なし。

## コンポジションのレシピ

### `children` によるスロット

```tsx
<Layout>
  <Header />
  <Main>{content}</Main>
</Layout>
```

### 名前付きスロット

```tsx
<Page header={<Nav />} sidebar={<Filters />}>
  <Results />
</Page>
```

### 複合コンポーネント（Context 経由で共有 state）

```tsx
<Tabs defaultValue="profile">
  <Tabs.List>
    <Tabs.Trigger value="profile">Profile</Tabs.Trigger>
    <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="profile"><Profile /></Tabs.Panel>
  <Tabs.Panel value="settings"><Settings /></Tabs.Panel>
</Tabs>
```

### レンダープロップ / 関数 as children

レンダリング出力にパラメーターを渡す必要がある場合に有用:

```tsx
<DataLoader id={id}>
  {({ data, isLoading }) => isLoading ? <Spinner /> : <UserCard user={data} />}
</DataLoader>
```

モダンな代替: 同じ形状を返すフック（`useData(id)`）— 通常こちらがよりクリーン。

## パフォーマンス

### `React.memo` が実際に効果的な場面

以下の場合にのみコンポーネントを `React.memo` でラップする:

1. 頻繁に再レンダリングされる
2. レンダリング間でプロップがたいてい同じ
3. レンダリングが計測可能なほど高コスト

`React.memo` はすべてのレンダリングで等価チェックを追加する。ほとんどのレンダリングでプロップが異なる場合、チェックは純粋なオーバーヘッドになる。

### レンダーカスケードの回避

- 可能な限り state を上ではなく下にリフトする
- Context を分割する: 懸念ごとに 1 つの Context、`themeContext` の変更が auth コンシューマーを再レンダリングしないように
- 外部 state ライブラリには `useSyncExternalStore` を使用する — 安全な並行レンダリングに必要

### リスト

- 安定した `key` プロップを提供する（配列インデックスではなくデータベース ID）
- 非自明な行を持つ表示アイテム数が ~50 を超える長いリストは `@tanstack/react-virtual` または `react-window` で仮想化する

## アクセシビリティファーストのコンポジション

- `role` 属性に頼る前に常にセマンティックな HTML（`<button>`、`<a>`、`<nav>`、`<main>`）をレンダリングする
- すべてのインタラクティブな要素はキーボードで操作可能でなければならない
- フォーム入力にはラベルが必要 — `<label htmlFor>` またはアイコンで視覚的にラベル付けされている場合は `aria-label`
- ルート変更とモーダルの開閉時にフォーカスを管理する
- コンポーネントテストで `axe` を実行する（[skills/react-testing](../react-testing/SKILL.md) を参照）
- クロスリンク: [skills/accessibility/SKILL.md](../accessibility/SKILL.md) は WCAG 基準とパターンライブラリを扱う

## ルーティング

このスキルはルーター非依存。上記のパターンは React Router、TanStack Router、Next.js App Router、Remix Router で動作する。ルーター固有のパターン（ローダー、アクション、ネストされたレイアウト）はルーターのドキュメントに従う — それらは React コアの上に積み重なったフレームワークの懸念事項。

## スコープ外（ポインターセクション）

- **Next.js 固有**: App Router データローディング、Route Handlers、Middleware、Parallel Routes — 別の懸念事項、Next.js ドキュメントを使用する
- **React Native**: プラットフォーム固有のパターンは別の `react-native-patterns` スキルが必要なほど異なる（現在未存在）
- **Remix**: ローダー/アクションの規約は RSC と重複するが Remix ドキュメントに従う

## 関連

- ルール: [rules/react/](../../rules/react/) — coding-style、hooks、patterns、security、testing
- スキル: パフォーマンスルールセットは [react-performance](../react-performance/SKILL.md)、クロスフレームワーク UI の懸念は [frontend-patterns](../frontend-patterns/SKILL.md)、[accessibility](../accessibility/SKILL.md)、フレームワーク比較は [angular-developer](../angular-developer/SKILL.md)
- エージェント: コードレビューは `react-reviewer`、ビルド/バンドラーエラーは `react-build-resolver`
- コマンド: `/react-review`、`/react-build`、`/react-test`

## 例

### デバウンス検索のカスタムフック

```tsx
function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function SearchBox() {
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);
  const { data } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => searchApi(debounced),
    enabled: debounced.length > 0,
  });
  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <Results items={data ?? []} />
    </>
  );
}
```

### React 19 `useOptimistic` によるオプティミスティック UI

```tsx
"use client";
import { useOptimistic } from "react";

export function MessageList({ messages }: { messages: Message[] }) {
  const [optimistic, addOptimistic] = useOptimistic(
    messages,
    (state, newMessage: Message) => [...state, newMessage],
  );

  async function send(formData: FormData) {
    const text = String(formData.get("text"));
    addOptimistic({ id: "pending", text, sender: "me" });
    await saveMessage(text);
  }

  return (
    <>
      <ul>{optimistic.map((m) => <li key={m.id}>{m.text}</li>)}</ul>
      <form action={send}>
        <input name="text" />
        <button type="submit">Send</button>
      </form>
    </>
  );
}
```

### レンダーカスケードを避けるための Context の分割

```tsx
// 2 つの Context: 一方はめったに変わらない、一方は頻繁に変わる
const ThemeContext = createContext<Theme>("light");
const NotificationsContext = createContext<Notification[]>([]);

// ThemeContext のみを消費するコンポーネントは通知が変わっても再レンダリングされない
```
