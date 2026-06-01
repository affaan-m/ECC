---
name: get-video-duration
description: Mediabunny を使用して動画ファイルの長さを秒単位で取得する
metadata:
  tags: duration, video, length, time, seconds
---

# Mediabunny で動画の長さを取得する

Mediabunny は動画ファイルの長さを抽出できます。ブラウザ、Node.js、Bun の各環境で動作します。

## 動画の長さの取得

```tsx
import { Input, ALL_FORMATS, UrlSource } from "mediabunny";

export const getVideoDuration = async (src: string) => {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(src, {
      getRetryDelay: () => null,
    }),
  });

  const durationInSeconds = await input.computeDuration();
  return durationInSeconds;
};
```

## 使用方法

```tsx
const duration = await getVideoDuration("https://remotion.media/video.mp4");
console.log(duration); // 例: 10.5（秒）
```

## ローカルファイルを使用する場合

ローカルファイルには `UrlSource` の代わりに `FileSource` を使用します。

```tsx
import { Input, ALL_FORMATS, FileSource } from "mediabunny";

const input = new Input({
  formats: ALL_FORMATS,
  source: new FileSource(file), // input 要素またはドラッグ＆ドロップから取得した File オブジェクト
});

const durationInSeconds = await input.computeDuration();
```

## Remotion で staticFile を使用する場合

```tsx
import { staticFile } from "remotion";

const duration = await getVideoDuration(staticFile("video.mp4"));
```
