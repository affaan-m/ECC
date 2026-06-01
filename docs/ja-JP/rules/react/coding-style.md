---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/components/**/*.ts"
  - "**/components/**/*.js"
  - "**/hooks/**/*.ts"
  - "**/hooks/**/*.js"
---
# React コーディングスタイル

> このファイルは [typescript/coding-style.md](../typescript/coding-style.md) および [common/coding-style.md](../common/coding-style.md) を React 固有の内容で拡張します。

## ファイル拡張子

- `.tsx` — 1行のスニペットであっても JSX を含むすべてのファイルに使用する
- `.ts` — 純粋なロジック、JSX を含まないカスタムフック、型定義、ユーティリティに使用する
- `.test.tsx` / `.test.ts` — ソースファイルに対応する形で命名する
- `.jsx` はプロジェクトが意図的に TypeScript を避けている場合のみ使用する — レビュー時に型付けされていない新しい React ファイルはすべて指摘する

## 命名規則

- コンポーネント: シンボルとファイル名の両方に `PascalCase` を使用する（`UserCard.tsx`、デフォルトエクスポートは `UserCard`）
- カスタムフック: シンボルには `useCamelCase`、プロジェクト規約がケバブケースの場合はファイル名にケバブケースを使用する（`use-debounce.ts` が `useDebounce` をエクスポートする）
- Context: シンボルは `<Domain>Context`、プロバイダーコンポーネントは `<Domain>Provider`、コンシューマーフックは `use<Domain>`
- イベントハンドラー: コンポーネント内では `handleClick`、`handleSubmit`; それを受け取るプロップは `onClick`、`onSubmit`
- 真偽値プロップ: `isLoading`、`hasError`、`canSubmit` — 真偽値に対して `loading` や `error` 単体は使用しない

## コンポーネントの形状

```tsx
type Props = {
  user: User;
  onSelect: (id: string) => void;
};

export function UserCard({ user, onSelect }: Props) {
  return (
    <button type="button" onClick={() => onSelect(user.id)}>
      {user.name}
    </button>
  );
}
```

- 閉じたコンポーネントのプロップ形状には `type Props = {}` を優先する
- `interface` はプロップ型が宣言マージを通じて拡張される場合、またはパブリック API の拡張ポイントとしてエクスポートされる場合にのみ使用する
- パラメーターリストで常にプロップを分割代入する — 本体内での `props.user` アクセスは禁止
- 戻り値の型は JSX を通じて暗黙的に型付けする（関数が条件付きで返り、ユニオンが型推論を混乱させる場合のみ `function Foo(): JSX.Element` と明示する）

## JSX

- 子要素のないタグはセルフクローズする: `<img />`、`<UserCard user={u} />`
- DOM 要素が不要な場合は `<div>` ラッパーの代わりにフラグメント `<>...</>` を使用する
- 条件付きレンダリング: 真偽値には `{condition && <Foo />}`、either/or には三項演算子、ガード節には早期リターン
- 複数行になる場合は JSX 内にロジックをインライン記述しない — `return` の上の `const` や別関数に切り出す

```tsx
// 推奨
const greeting = user.isAdmin ? "Welcome, admin" : `Hello ${user.name}`;
return <h1>{greeting}</h1>;

// 非推奨
return <h1>{user.isAdmin ? "Welcome, admin" : `Hello ${user.name}`}</h1>;
```

## サーバー / クライアント境界（Next.js App Router、RSC）

- 新規ファイルはデフォルトで Server Component にする — state、effect、ref、ブラウザ API、イベントハンドラーを使用する場合にのみ `"use client"` を追加する
- `"use client"` ディレクティブは 1 行目、インポートより前に記述する
- `"use server"` アクションファイルの内部から Client Component ファイルをインポートしない
- クライアントモジュールを通じてサーバー専用コードを再エクスポートしない — バンドラーが静かにそれを含めてしまう

## インポート

- React インポートを最初に: `import { useState } from "react"`
- 次にサードパーティライブラリ、次にプロジェクトの絶対インポート、次に相対インポート
- 型専用インポート: `import type { ReactNode } from "react"` — ESLint の `consistent-type-imports` が設定されている場合、1つのステートメントでランタイムインポートと型インポートを混在させない

## フックの規律

完全なルールセットは [hooks.md](./hooks.md) を参照。スタイルのハイライト:

- カスタムフックは必ず `use` で始める — `eslint-plugin-react-hooks` によって強制される
- すべてのフック呼び出しをコンポーネントの先頭にまとめ、条件ロジックの前に置く
- 1行のラッパーのためにアドホックなフックを作成しない — インラインで呼び出す

## State

- まずローカル（`useState`）で管理し、共有が必要な場合のみリフトする
- Context は多数のコンポーネントで読まれるクロスカッティングな state（theme、auth、i18n）に使用する — 高頻度の更新には使用しない
- 外部ストア（Zustand、Jotai、Redux Toolkit）は state がルート変更を越えて永続化する必要がある場合、タブ間で同期する必要がある場合、または devtools でデバッグする必要がある場合に使用する
- 導出できる state を複製しない — レンダリング中に計算する

## クラスコンポーネント

新規コードでは禁止。非自明な変更を加える際にはレガシーなクラスコンポーネントを関数コンポーネントに変換する。

## コンポーネントごとのファイルレイアウト

```
components/UserCard/
  UserCard.tsx
  UserCard.module.css   # または styled-components、またはTailwindクラスをインライン
  UserCard.test.tsx
  index.ts              # 再エクスポートのみ
```

単純なプレゼンテーション用コンポーネントには単一ファイルのインライン記述も問題ない。
