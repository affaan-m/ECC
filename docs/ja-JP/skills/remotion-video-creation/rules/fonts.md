---
name: fonts
description: Remotion での Google Fonts およびローカルフォントの読み込み
metadata:
  tags: fonts, google-fonts, typography, text
---

# Remotion でフォントを使用する

## @remotion/google-fonts を使った Google Fonts

Google Fonts を使用するための推奨方法です。型安全であり、フォントの準備が完了するまで自動的にレンダリングをブロックします。

### 前提条件

まず、@remotion/google-fonts パッケージをインストールする必要があります。
インストールされていない場合は、以下のコマンドを使用してください。

```bash
npx remotion add @remotion/google-fonts # npm を使用するプロジェクトの場合
bunx remotion add @remotion/google-fonts # bun を使用するプロジェクトの場合
yarn remotion add @remotion/google-fonts # yarn を使用するプロジェクトの場合
pnpm exec remotion add @remotion/google-fonts # pnpm を使用するプロジェクトの場合
```

```tsx
import { loadFont } from "@remotion/google-fonts/Lobster";

const { fontFamily } = loadFont();

export const MyComposition = () => {
  return <div style={{ fontFamily }}>Hello World</div>;
};
```

ファイルサイズを抑えるため、必要なウェイトとサブセットのみを指定することを推奨します。

```tsx
import { loadFont } from "@remotion/google-fonts/Roboto";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});
```

### フォントのロード完了を待つ

フォントの準備が完了するタイミングを知る必要がある場合は `waitUntilDone()` を使用します。

```tsx
import { loadFont } from "@remotion/google-fonts/Lobster";

const { fontFamily, waitUntilDone } = loadFont();

await waitUntilDone();
```

## @remotion/fonts を使ったローカルフォント

ローカルフォントファイルには `@remotion/fonts` パッケージを使用します。

### 前提条件

まず @remotion/fonts をインストールします。

```bash
npx remotion add @remotion/fonts # npm を使用するプロジェクトの場合
bunx remotion add @remotion/fonts # bun を使用するプロジェクトの場合
yarn remotion add @remotion/fonts # yarn を使用するプロジェクトの場合
pnpm exec remotion add @remotion/fonts # pnpm を使用するプロジェクトの場合
```

### ローカルフォントの読み込み

フォントファイルを `public/` フォルダに配置し、`loadFont()` を使用します。

```tsx
import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

await loadFont({
  family: "MyFont",
  url: staticFile("MyFont-Regular.woff2"),
});

export const MyComposition = () => {
  return <div style={{ fontFamily: "MyFont" }}>Hello World</div>;
};
```

### 複数ウェイトの読み込み

同じファミリー名を使用して、各ウェイトを個別に読み込みます。

```tsx
import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

await Promise.all([
  loadFont({
    family: "Inter",
    url: staticFile("Inter-Regular.woff2"),
    weight: "400",
  }),
  loadFont({
    family: "Inter",
    url: staticFile("Inter-Bold.woff2"),
    weight: "700",
  }),
]);
```

### 利用可能なオプション

```tsx
loadFont({
  family: "MyFont", // 必須: CSS で使用する名前
  url: staticFile("font.woff2"), // 必須: フォントファイルの URL
  format: "woff2", // オプション: 拡張子から自動検出
  weight: "400", // オプション: フォントウェイト
  style: "normal", // オプション: normal または italic
  display: "block", // オプション: font-display の動作
});
```

## コンポーネントでの使用

`loadFont()` はコンポーネントのトップレベル、または早期にインポートされる別ファイルで呼び出してください。

```tsx
import { loadFont } from "@remotion/google-fonts/Montserrat";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

export const Title: React.FC<{ text: string }> = ({ text }) => {
  return (
    <h1
      style={{
        fontFamily,
        fontSize: 80,
        fontWeight: "bold",
      }}
    >
      {text}
    </h1>
  );
};
```
