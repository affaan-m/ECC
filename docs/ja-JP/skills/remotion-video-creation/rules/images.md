---
name: images
description: Remotion で <Img> コンポーネントを使って画像を埋め込む
metadata:
  tags: images, img, staticFile, png, jpg, svg, webp
---

# Remotion で画像を使用する

## `<Img>` コンポーネント

画像を表示するには、必ず `remotion` の `<Img>` コンポーネントを使用してください。

```tsx
import { Img, staticFile } from "remotion";

export const MyComposition = () => {
  return <Img src={staticFile("photo.png")} />;
};
```

## 重要な制約

**`remotion` の `<Img>` コンポーネントを必ず使用してください。** 以下は使用しないでください。

- ネイティブ HTML の `<img>` 要素
- Next.js の `<Image>` コンポーネント
- CSS の `background-image`

`<Img>` コンポーネントは、動画エクスポート時に画像が完全に読み込まれてからレンダリングを行うため、ちらつきや空白フレームを防ぎます。

## staticFile() によるローカル画像

画像を `public/` フォルダに配置し、`staticFile()` で参照します。

```
my-video/
├─ public/
│  ├─ logo.png
│  ├─ avatar.jpg
│  └─ icon.svg
├─ src/
├─ package.json
```

```tsx
import { Img, staticFile } from "remotion";

<Img src={staticFile("logo.png")} />
```

## リモート画像

リモート URL は `staticFile()` なしで直接使用できます。

```tsx
<Img src="https://example.com/image.png" />
```

リモート画像は CORS が有効である必要があります。

アニメーション GIF の場合は、代わりに `@remotion/gif` の `<Gif>` コンポーネントを使用してください。

## サイズと位置

`style` プロパティでサイズと位置を制御します。

```tsx
<Img
  src={staticFile("photo.png")}
  style={{
    width: 500,
    height: 300,
    position: "absolute",
    top: 100,
    left: 50,
    objectFit: "cover",
  }}
/>
```

## 動的な画像パス

テンプレートリテラルを使って動的なファイル参照を実現します。

```tsx
import { Img, staticFile, useCurrentFrame } from "remotion";

const frame = useCurrentFrame();

// 画像シーケンス
<Img src={staticFile(`frames/frame${frame}.png`)} />

// プロパティに基づく選択
<Img src={staticFile(`avatars/${props.userId}.png`)} />

// 条件による画像切り替え
<Img src={staticFile(`icons/${isActive ? "active" : "inactive"}.svg`)} />
```

このパターンは以下の場面で有用です。

- 画像シーケンス（フレーム単位のアニメーション）
- ユーザー固有のアバターやプロフィール画像
- テーマに基づくアイコン
- 状態依存のグラフィック

## 画像サイズの取得

`getImageDimensions()` で画像の寸法を取得できます。

```tsx
import { getImageDimensions, staticFile } from "remotion";

const { width, height } = await getImageDimensions(staticFile("photo.png"));
```

アスペクト比の計算やコンポジションのサイズ設定に便利です。

```tsx
import { getImageDimensions, staticFile, CalculateMetadataFunction } from "remotion";

const calculateMetadata: CalculateMetadataFunction = async () => {
  const { width, height } = await getImageDimensions(staticFile("photo.png"));
  return {
    width,
    height,
  };
};
```
