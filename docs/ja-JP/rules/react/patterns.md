---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/components/**/*.ts"
  - "**/components/**/*.js"
  - "**/app/**/*.tsx"
  - "**/pages/**/*.tsx"
---
# React パターン

> このファイルは [typescript/patterns.md](../typescript/patterns.md) および [common/patterns.md](../common/patterns.md) を React 固有の内容で拡張します。フック固有のルールは [hooks.md](./hooks.md) を参照してください。

## コンテナー / プレゼンテーション分割

コンテナーコンポーネントはデータフェッチ、state、副作用を担う。プレゼンテーショナルコンポーネントはプロップを受け取ってレンダリングする — サービス呼び出しなし、ローカル UI state 以外のフックなし。

```tsx
// コンテナー — データを所有する
export function UserPage({ userId }: { userId: string }) {
  const { data: user, isLoading } = useUser(userId);
  if (isLoading) return <Spinner />;
  if (!user) return <NotFound />;
  return <UserCard user={user} onSelect={handleSelect} />;
}

// プレゼンテーショナル — 純粋
export function UserCard({ user, onSelect }: { user: User; onSelect: (id: string) => void }) {
  return <button onClick={() => onSelect(user.id)}>{user.name}</button>;
}
```

## State の配置決定木

1. 1 つのコンポーネントのみで使用 → その中の `useState`
2. 親と少数の子で使用 → 最も近い共通祖先にリフトし、プロップ経由で渡す
3. 距離の離れたブランチ全体で使用 → **低頻度の読み取りのみ**を対象とした React Context（theme、auth、locale）
4. ツリー全体で共有される高頻度の更新 → 外部ストア（Zustand、Jotai、Redux Toolkit）
5. サーバー由来のデータ → サーバー state ライブラリ（TanStack Query、SWR、RSC fetch）— アプリケーション state ではない

Context を頻繁に変化する値に誤用すると、すべてのコンシューマーが更新のたびに再レンダリングされる。

## サーバー / クライアントコンポーネント境界（RSC、Next.js App Router）

- Server Components がデフォルト — サーバーで実行され、クライアントには送信されず、直接 `await` できる
- Client Components はファイルの先頭に `"use client"` を記述することでオプトインする
- データは下方向に流れる: Server Component は Client Component をレンダリングしてシリアライズ可能なプロップを渡せる
- Client Component は Server Component をインポートできないが、`children` や名前付きスロットを通じて受け取ることはできる

```tsx
// サーバー（デフォルト）
export default async function Page() {
  const user = await fetchUser();
  return <UserClient user={user} />;
}

// クライアント
"use client";
export function UserClient({ user }: { user: User }) {
  const [tab, setTab] = useState("profile");
  return <Tabs value={tab} onChange={setTab}>{user.name}</Tabs>;
}
```

- Client Component ファイルから `"server-only"` パッケージ（DB クライアント、シークレット）をインポートしない — Server Component または Server Action でラップする
- バンドラーがクライアントファイルによるインポートをエラーにするよう、センシティブなモジュールに `import "server-only"` を追記する

## Suspense + エラー境界

すべての Suspense 境界の上にエラー境界が必要。このペアが両方の状態を処理する。

```tsx
<ErrorBoundary fallback={<ErrorView />}>
  <Suspense fallback={<Skeleton />}>
    <UserDetails id={id} />
  </Suspense>
</ErrorBoundary>
```

- Suspense 境界はルートルートではなく、データが必要な場所の近くに配置する
- 複数の狭い境界によりロードされたコンテンツを段階的に表示できる
- エラー境界はクラスコンポーネントでなければならない（React 19 にはまだ関数型の同等実装がない）、または `react-error-boundary` などのラッパーライブラリを使用する

## フォーム

### 非制御（React 19 + フォームアクション）

フォームが明確な送信ステップを持つ場合は、フォームアクションを使用した非制御入力を優先する。ブラウザが値を所有し、React は送信時に `FormData` を通じて値を読み取る。

```tsx
async function action(formData: FormData) {
  "use server";
  await saveUser({ name: String(formData.get("name")) });
}

export function UserForm() {
  return (
    <form action={action}>
      <input name="name" required />
      <button type="submit">Save</button>
    </form>
  );
}
```

### 制御

値が他の UI を駆動する場合、リアルタイムバリデーションが必要な場合、またはフォーマットが必要な場合は制御入力を使用する。

```tsx
const [email, setEmail] = useState("");
return <input value={email} onChange={(e) => setEmail(e.target.value)} />;
```

### フォームライブラリ

複雑なフォーム（マルチステップ、動的フィールド配列、クロスフィールドバリデーション）にはライブラリを使用する:

- React Hook Form — 最小限の再レンダリング、非制御優先
- TanStack Form — 型付き、フレームワーク非依存
- Final Form — サブスクリプションベースの再レンダリングが重要な場合

## データフェッチ

| 戦略 | 使用場面 |
|---|---|
| RSC fetch（Server Component 内での `await`） | Next.js App Router でのリクエストごとのデータ、クライアント側キャッシュ不要 |
| TanStack Query | クライアント側キャッシュ、ミューテーション、オプティミスティック更新、ポーリング |
| SWR | 軽量なキャッシュ + 再検証、TanStack Query より簡潔 |
| `useEffect` 内の `fetch` | 避ける — 競合状態、キャッシュなし、リトライなし。1 回限りのファイアアンドフォーゲットのみ許容 |

実際のキャッシュライブラリが利用可能な場合は `useEffect` 内でフェッチしない — それらは重複排除、キャッシュ無効化、エラーリトライ、Suspense 統合を処理する。

## リストとキー

- `key` はレンダリング間で安定している必要がある — 並べ替え、挿入、削除が可能なリストには絶対に `index` を使わない
- `key` は兄弟間で一意でなければならない（グローバルに一意である必要はない）
- インデックスキーを使用した並べ替えリストは、子コンポーネントの state が間違った行に付着する原因になる

## 継承よりコンポジション

- スロットスタイルのコンポジションには `children` を渡す
- パラメーター化されたレンダリングにはレンダープロップ関数を渡す
- プラグインポイントにはコンポーネント型を渡す: `renderItem={UserRow}`
- コンポーネントクラスを継承して動作を特化させることは絶対にしない

## 複合コンポーネント

関連するコントロール（Tabs、Accordion、Menu）には、Context 経由で state を共有する複合コンポーネントを使用する:

```tsx
<Tabs defaultValue="profile">
  <Tabs.List>
    <Tabs.Trigger value="profile">Profile</Tabs.Trigger>
    <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="profile"><ProfileForm /></Tabs.Panel>
  <Tabs.Panel value="settings"><SettingsForm /></Tabs.Panel>
</Tabs>
```

## ポータル

モーダル、ツールチップ、トーストコンテナーには `createPortal` を使用する — 親の `overflow: hidden` や `z-index` のスタッキングコンテキストからエスケープする必要があるものすべて。`index.html` にマウントされた安定した DOM ノードにレンダリングする。

## Ref とフォワーディング（React 19+）

React 19 では関数コンポーネントが通常のプロップとして `ref` を受け取れるようになった — `forwardRef` はもはや不要。

```tsx
export function Input({ ref, ...rest }: { ref?: React.Ref<HTMLInputElement> } & InputProps) {
  return <input ref={ref} {...rest} />;
}
```

React 18 上の古いコードベースでは引き続き `forwardRef` が必要。

## スコープ外（ポインターセクション）

### Next.js（App Router）

- Server Actions、Route Handlers、Middleware、Parallel/Intercepted Routes、ストリーミング Metadata
- 別のフレームワークの懸念事項として扱う — Next.js 固有のパターンを深く追加する場合は専用の `rules/nextjs/` トラックを提案する
- 現時点では App Router の仕様については Next.js 公式ドキュメントに従う

### React Native

- プラットフォーム固有のインポート（`Platform.OS`、`.ios.tsx` / `.android.tsx`）、`StyleSheet`、ナビゲーションライブラリ（React Navigation、Expo Router）
- 別トラックとして扱う — `rules/react-native/` はまだ存在しない
- このファイルの React コアのフック/パターンは引き続き適用される

## スキルリファレンス

React 固有の詳細については `skills/react-patterns/SKILL.md` を参照。クロスフレームワークのフロントエンド懸念については `skills/frontend-patterns/SKILL.md` を参照。アクセシビリティについては `skills/accessibility/SKILL.md` を参照。
