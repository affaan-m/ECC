---
name: get-video-dimensions
description: Mediabunny を使用して動画ファイルの幅と高さを取得する
metadata:
  tags: dimensions, width, height, resolution, size, video
---

# Mediabunny で動画のサイズを取得する

Mediabunny は動画ファイルの幅と高さを抽出できます。ブラウザ、Node.js、Bun の各環境で動作します。

## 動画サイズの取得

```tsx
import { Input, ALL_FORMATS, UrlSource } from "mediabunny";

export const getVideoDimensions = async (src: string) => {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(src, {
      getRetryDelay: () => null,
    }),
  });

  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    throw new Error("No video track found");
  }

  return {
    width: videoTrack.displayWidth,
    height: videoTrack.displayHeight,
  };
};
```

## 使用方法

```tsx
const dimensions = await getVideoDimensions("https://remotion.media/video.mp4");
console.log(dimensions.width);  // 例: 1920
console.log(dimensions.height); // 例: 1080
```

## ローカルファイルを使用する場合

ローカルファイルには `UrlSource` の代わりに `FileSource` を使用します。

```tsx
import { Input, ALL_FORMATS, FileSource } from "mediabunny";

const input = new Input({
  formats: ALL_FORMATS,
  source: new FileSource(file), // input 要素またはドラッグ＆ドロップから取得した File オブジェクト
});

const videoTrack = await input.getPrimaryVideoTrack();
const width = videoTrack.displayWidth;
const height = videoTrack.displayHeight;
```

## Remotion で staticFile を使用する場合

```tsx
import { staticFile } from "remotion";

const dimensions = await getVideoDimensions(staticFile("video.mp4"));
```
