---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/hooks/**/*.ts"
  - "**/hooks/**/*.js"
  - "**/use-*.ts"
  - "**/use-*.tsx"
---
# React フック

> このファイルは **React フック**（`useState`、`useEffect`、`useMemo`、`useCallback`、カスタムフック）を対象としています — Claude Code の `hooks/` ランタイムシステムとは別物です。命名はこのリポジトリ全体で使用される言語別規約 `rules/<lang>/hooks.md` に準拠しています。
>
> [typescript/patterns.md](../typescript/patterns.md) および [common/patterns.md](../common/patterns.md) を拡張します。

## フックのルール

`eslint-plugin-react-hooks` を有効にし、`react-hooks/rules-of-hooks` をエラーに設定する。

1. フックは関数コンポーネントまたは別のフックのトップレベルでのみ使用する
2. ループ、条件分岐、ネストされた関数、早期リターンの後では使用しない
3. すべてのレンダリングで常に同じ順序で呼び出す
4. React 関数コンポーネントまたはカスタムフック（`use` で始まる関数）の内部でのみ使用する

```tsx
// 誤り: 条件付きフック
function Foo({ enabled }: { enabled: boolean }) {
  if (enabled) {
    const [x, setX] = useState(0); // ルール違反
  }
}

// 正しい: フックは無条件、条件は内部で
function Foo({ enabled }: { enabled: boolean }) {
  const [x, setX] = useState(0);
  if (!enabled) return null;
  return <span>{x}</span>;
}
```

## `useEffect` — 使わない場面

`useEffect` は外部システム（サブスクリプション、ブラウザ API、サードパーティライブラリ）との同期に使用する。以下には**適切なツールではない**:

- 派生 state — レンダリング中に計算する
- レンダリング用のデータ変換 — レンダリング中に計算する
- プロップ変更時の state リセット — 親に `key` を使うか、プロップから派生させる
- 親への state 変更通知 — イベントハンドラーでコールバックを呼び出す
- アプリレベルのシングルトンの初期化 — モジュールスコープまたは `main.tsx` で関数を呼び出す

```tsx
// 誤り: 派生 state のための effect
const [fullName, setFullName] = useState("");
useEffect(() => {
  setFullName(`${first} ${last}`);
}, [first, last]);

// 正しい: レンダリング中に派生させる
const fullName = `${first} ${last}`;
```

## 依存配列

- effect / コールバック内で参照するすべてのリアクティブな値を必ず含める
- `react-hooks/exhaustive-deps` lint ルールを有効にする — 理由をコメントなしにサイレンスしない
- 依存配列が肥大化する場合、effect がやりすぎ — 分割する
- deps に渡す関数の安定したアイデンティティ: 関数が別のフックの依存であるか、メモ化された子に渡される場合にのみ `useCallback` でラップする

## クリーンアップ

すべてのサブスクリプション、インターバル、リスナー、進行中のリクエストは必ずクリーンアップする。

```tsx
useEffect(() => {
  const controller = new AbortController();
  fetch(url, { signal: controller.signal }).then(handleResponse);
  return () => controller.abort();
}, [url]);
```

```tsx
useEffect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}, []);
```

クリーンアップが欠如すると、deps 変更時の競合状態やアンマウント時のメモリリークが発生する。

## `useMemo` と `useCallback` — 使う価値がある場面

デフォルトの立場: **メモ化しない**。以下の場合にのみ `useMemo` / `useCallback` を追加する:

1. 値が `React.memo` でラップされた子コンポーネントのプロップとして渡され、アイデンティティが重要な場合
2. 値が別の `useEffect` / `useMemo` / `useCallback` の依存である場合
3. 計算が計測可能なほど高コストな場合（仮定せずにプロファイリングする）

早まったメモ化はノイズを追加し、バグを隠し、置き換えようとする再計算より遅くなることもある。

## カスタムフック

以下の場合にカスタムフックを切り出す:

- 同じフックシーケンス（state + effect + computed）が 2 つ以上のコンポーネントに現れる
- ロジックが明確で名前付け可能な目的を持つ（`useDebounce`、`useOnClickOutside`、`useLocalStorage`）
- コンポーネントから独立してロジックをテストしたい

以下の場合は**切り出さない**:

- 呼び出し元が 1 つしかない — インラインで記述する
- 「フック」が名前の異なる `useState` にすぎない — 間接参照が増えるだけで価値がない

```tsx
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
```

## `useState` のパターン

- マウント時のみプロップからの初期 state: 計算が高コストな場合は関数 `useState(() => computeInitial(prop))` を渡す
- 新しい state が古い state に依存する場合は関数型アップデーター: `setCount(c => c + 1)` — 非同期またはバッチコンテキスト内では `setCount(count + 1)` は使わない
- 常に一緒に変わる場合のみ関連する state を 1 つのオブジェクトにまとめる; そうでなければ複数の `useState` 呼び出しに分割する
- state 遷移が前の state に条件付きであるか、関連する値が 3 つ以上ある場合は `useReducer` を使用する

## `useRef` のパターン

- 命令型 API（フォーカス、スクロール、サードパーティライブラリ）用の DOM ref
- 再レンダリングをトリガーしないミュータブルなコンテナ（タイマー ID、前の値、「マウント済み」フラグ）
- レンダリング中に `ref.current` を読み書きしない — effect またはイベントハンドラー内でのみ操作する
- `useImperativeHandle` は親 ref に子の API を公開する場合にのみ使用する — 最後の手段のエスケープハッチ

## `useSyncExternalStore`

外部ストア（ブラウザ API、サードパーティ state ライブラリ、カスタムイベントエミッター）をサブスクライブするためにこのフックを使用する。並行レンダリングで外部 state を安全に扱うためのサポートされた方法。

```tsx
const isOnline = useSyncExternalStore(
  (cb) => {
    window.addEventListener("online", cb);
    window.addEventListener("offline", cb);
    return () => {
      window.removeEventListener("online", cb);
      window.removeEventListener("offline", cb);
    };
  },
  () => navigator.onLine,
  () => true,
);
```

## React 19 の追加機能

- `use()` — Promise とコンテキストをインラインでアンラップする; 条件付きで使用可能（この特性を持つ唯一のフック）
- `useFormStatus()` / `useFormState()`（または `useActionState`）— プロップドリリングなしのフォーム送信状態
- `useOptimistic()` — サーバーアクション実行中のオプティミスティック UI 更新
- `useTransition()` — 緊急でない state 更新をマークして緊急な更新の応答性を維持する

プロジェクトが React 19+ をターゲットにしている場合、手作りの同等実装よりこれらを優先する。

## ステールクロージャのトラップ

非同期ハンドラーとインターバルは、作成されたレンダリング時の値をキャプチャする。以下の方法で修正する:

1. `setState` の関数型アップデーター形式を使用する
2. 変化する値を `useEffect` の依存配列に入れてハンドラーを再構築する
3. 同期状態を保つ ref から読み取る

## Lint 設定

必須ルール:

```json
{
  "rules": {
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn"
  }
}
```

新規コードについては CI で `exhaustive-deps` の警告をエラーとして扱う。
