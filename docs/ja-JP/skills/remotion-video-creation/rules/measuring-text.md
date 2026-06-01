---
name: measuring-text
description: テキストの寸法計測、コンテナへのフィット、オーバーフローの確認
metadata:
  tags: measure, text, layout, dimensions, fitText, fillTextBox
---

# Remotion でテキストを計測する

## 前提条件

@remotion/layout-utils がインストールされていない場合はインストールしてください。

```bash
npx remotion add @remotion/layout-utils # If project uses npm
bunx remotion add @remotion/layout-utils # If project uses bun
yarn remotion add @remotion/layout-utils # If project uses yarn
pnpm exec remotion add @remotion/layout-utils # If project uses pnpm
```

## テキストの寸法を計測する

`measureText()` でテキストの幅と高さを計算します。

```tsx
import { measureText } from "@remotion/layout-utils";

const { width, height } = measureText({
  text: "Hello World",
  fontFamily: "Arial",
  fontSize: 32,
  fontWeight: "bold",
});
```

結果はキャッシュされるため、同じ引数での重複呼び出しはキャッシュされた値を返します。

## テキストを幅に合わせる

`fitText()` でコンテナに最適なフォントサイズを求めます。

```tsx
import { fitText } from "@remotion/layout-utils";

const { fontSize } = fitText({
  text: "Hello World",
  withinWidth: 600,
  fontFamily: "Inter",
  fontWeight: "bold",
});

return (
  <div
    style={{
      fontSize: Math.min(fontSize, 80), // 80px を上限とする
      fontFamily: "Inter",
      fontWeight: "bold",
    }}
  >
    Hello World
  </div>
);
```

## テキストのオーバーフローを確認する

`fillTextBox()` でテキストがボックスをはみ出すかどうかを確認します。

```tsx
import { fillTextBox } from "@remotion/layout-utils";

const box = fillTextBox({ maxBoxWidth: 400, maxLines: 3 });

const words = ["Hello", "World", "This", "is", "a", "test"];
for (const word of words) {
  const { exceedsBox } = box.add({
    text: word + " ",
    fontFamily: "Arial",
    fontSize: 24,
  });
  if (exceedsBox) {
    // テキストがオーバーフローするため適切に処理する
    break;
  }
}
```

## ベストプラクティス

**フォントを先に読み込む:** 計測関数はフォントが読み込まれた後にのみ呼び出してください。

```tsx
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily, waitUntilDone } = loadFont("normal", {
  weights: ["400"],
  subsets: ["latin"],
});

waitUntilDone().then(() => {
  // ここから計測が安全に行える
  const { width } = measureText({
    text: "Hello",
    fontFamily,
    fontSize: 32,
  });
})
```

**`validateFontIsLoaded` を使用する:** フォントの読み込み問題を早期に検出します。

```tsx
measureText({
  text: "Hello",
  fontFamily: "MyCustomFont",
  fontSize: 32,
  validateFontIsLoaded: true, // フォント未読み込み時にエラーをスロー
});
```

**フォントプロパティを一致させる:** 計測とレンダリングで同じプロパティを使用してください。

```tsx
const fontStyle = {
  fontFamily: "Inter",
  fontSize: 32,
  fontWeight: "bold" as const,
  letterSpacing: "0.5px",
};

const { width } = measureText({
  text: "Hello",
  ...fontStyle,
});

return <div style={fontStyle}>Hello</div>;
```

**padding と border を避ける:** レイアウトのずれを防ぐために `border` の代わりに `outline` を使用します。

```tsx
<div style={{ outline: "2px solid red" }}>Text</div>
```
