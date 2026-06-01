---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/components/**/*.ts"
  - "**/app/**/*.ts"
  - "**/pages/**/*.ts"
---
# React セキュリティ

> このファイルは [typescript/security.md](../typescript/security.md) および [common/security.md](../common/security.md) を React 固有の内容で拡張します。

## `dangerouslySetInnerHTML` を介した XSS

重大。プロップ名が意図的に警告的な名称になっている — すべての使用箇所をコードレビューの停止点として扱う。

```tsx
// 重大: サニタイズされていないユーザー入力
<div dangerouslySetInnerHTML={{ __html: userBio }} />

// 正しい選択肢:
// 1. テキストとしてレンダリングする
<div>{userBio}</div>

// 2. サニタイズを行うライブラリを介してパース済み Markdown をレンダリングする
<ReactMarkdown>{userBio}</ReactMarkdown>

// 3. 生の HTML が必要な場合は DOMPurify で事前にサニタイズする
import DOMPurify from "isomorphic-dompurify";
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userBio) }} />
```

すべての `dangerouslySetInnerHTML` 呼び出しに対する監査チェックリスト:

- 入力が常に自分たちの管理下にあるか? ソースを文書化する。
- ユーザー由来の場合: **同一の呼び出し箇所**でサニタイズされているか?（API 境界でのサニタイズはすべてのコンシューマーが検証されている場合のみ許容）
- サニタイザーの設定はタグをブロックリストではなく許可リストで管理しているか?

## 安全でない URL スキーム

`href`、`src`、`xlink:href` 内の `javascript:` と `data:` URL は任意のコードを実行する。

```tsx
// 重大: javascript: URL インジェクション
<a href={user.website}>Visit</a>   // user.website = "javascript:alert(1)" の場合

// 正しい: スキームを検証する
function safeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) return url;
  } catch {
    return undefined;
  }
  return undefined;
}
<a href={safeUrl(user.website)}>Visit</a>
```

React は開発モードで `href` の `javascript:` URL について警告するが、ランタイムではブロックしない。`data:` URL やその他のスキームも通過してしまう。常に検証すること。

## `rel` なしの `target="_blank"`

`rel="noopener noreferrer"` なしの `<a target="_blank">` はターゲットページが `window.opener` にアクセスしてナビゲーションハイジャックを実行することを許可する。

```tsx
// 誤り
<a href={externalUrl} target="_blank">External</a>

// 正しい
<a href={externalUrl} target="_blank" rel="noopener noreferrer">External</a>
```

最近のブラウザは `target="_blank"` 時にデフォルトで `noopener` になるが、ブラウザのデフォルトに依存しない — 明示的に記述する。

## Server Action の入力バリデーション

Server Actions（`"use server"`）はパブリック API エンドポイントと同じ信頼レベルで実行される。すべての入力を検証する。

```tsx
"use server";
import { z } from "zod";

const Input = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(120),
});

export async function updateUser(_state: unknown, formData: FormData) {
  const parsed = Input.safeParse({
    email: formData.get("email"),
    age: Number(formData.get("age")),
  });
  if (!parsed.success) return { error: parsed.error.flatten() };
  // ...
}
```

- アクション内で認証する — クライアント側のルートゲートを信頼しない
- 認可: 現在のユーザーがミューテートしようとしている特定のレコードに対する権限を持っているか確認する
- センシティブなアクションにはレート制限を設ける

## 環境変数によるシークレット漏洩

プレフィックス付きの環境変数はクライアントにバンドルされる。公開情報として扱う。

| フレームワーク | 公開プレフィックス | プライベート |
|---|---|---|
| Next.js | `NEXT_PUBLIC_*` | それ以外すべて |
| Vite | `VITE_*` | `.env` サーバーサイドのみ |
| Create React App | `REACT_APP_*`、`NODE_ENV`、`PUBLIC_URL` | それ以外すべて（`REACT_APP_` プレフィックスなしはサーバーサイドのみ） |
| Remix | `loader`/`action` 内の `process.env` アクセスのみ | 同様 |

```ts
// 重大: シークレットがクライアントバンドルに漏洩
const apiKey = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;
```

環境変数に触れるすべての PR で監査する: この文字列がパブリックバンドルに含まれると問題になるか?

## 認証 / 認可

- セッションを `localStorage` に保存しない — XSS からアクセス可能。httpOnly セキュアクッキーを使用する。
- センシティブな UI をゲートするためにクライアント設定の state を信頼しない。JSX でのレンダーゲーティングは表示を防ぐだけ — API で強制する必要がある。
- CSRF: クッキーベースの認証には CSRF トークンまたは `SameSite=Strict`/`Lax` クッキーが必要
- フレームワークのデフォルトを使用しない場合、フォームアクションにはダブルサブミットクッキーまたはオリジン検証を使用する

## Content Security Policy（CSP）

サーバーサイドで設定する。React アプリに最低限許容できる CSP:

```
default-src 'self';
script-src 'self' 'nonce-{REQUEST_NONCE}';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
connect-src 'self' https://api.example.com;
frame-ancestors 'none';
```

- `script-src` では `unsafe-inline` と `unsafe-eval` を避ける
- インラインスクリプトを含む SSR（Next.js ストリーミング、ハイドレーションデータ）にはリクエストごとの nonce を使用する — Next.js と Remix はどちらも nonce インジェクションをサポートしている
- CSS-in-JS ライブラリには `style-src 'unsafe-inline'` が避けられないことが多い — トレードオフを文書化する

## オブジェクトスプレッドによるプロトタイプ汚染

```tsx
// 誤り: 信頼できない JSON を直接 state にスプレッド
const update = await req.json();
setState({ ...state, ...update });    // 攻撃者が __proto__ を制御できる

// 正しい: スキーマでパースするか、キーをガードする
const Allowed = z.object({ name: z.string(), email: z.string().email() });
const parsed = Allowed.parse(await req.json());
setState({ ...state, ...parsed });
```

## SSR テンプレートインジェクション

`renderToString` または `renderToPipeableStream` を使用する場合:

- JSX 内でレンダリングされるすべての値は React によってエスケープされる — 安全
- `dangerouslySetInnerHTML` に渡された値はエスケープされない — クライアントと同じルールを適用する
- React 出力の周囲に手動で構築した HTML ラッパーはエスケープまたはサニタイズする必要がある — 周囲の HTML テンプレートにユーザー入力を連結しない

## サードパーティコンポーネント

- UI ライブラリを追加する前に `npm audit` で監査する
- ライブラリが入力に `dangerouslySetInnerHTML` を内部的に使用していないか確認する（例: リッチテキストエディター）
- バージョンを固定し、メジャーアップグレード前に変更ログをレビューする
- HTML 文字列をプロップとして受け取るコンポーネントに注意する

## 本番環境でのソースマップ漏洩

本番ビルドではソースマップなしでリリースするか、エラートラッカー（Sentry）にアップロードしてパブリックバンドルから除去する。パブリックなソースマップは内部ロジックとファイル構造を漏洩する。

## エージェントサポート

- コードベース全体の包括的なセキュリティ監査には `security-reviewer` エージェントを使用する
- アクティブなコードレビューで React 固有のパターンと上記ルールを確認するには `react-reviewer` エージェントを使用する
