---
name: get-audio-duration
description: Mediabunny を使用して音声ファイルの長さを秒単位で取得する
metadata:
  tags: duration, audio, length, time, seconds, mp3, wav
---

# Mediabunny で音声の長さを取得する

Mediabunny は音声ファイルの長さを抽出できます。ブラウザ、Node.js、Bun の各環境で動作します。

## 音声の長さの取得

```tsx
import { Input, ALL_FORMATS, UrlSource } from "mediabunny";

export const getAudioDuration = async (src: string) => {
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
const duration = await getAudioDuration("https://remotion.media/audio.mp3");
console.log(duration); // 例: 180.5（秒）
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

const duration = await getAudioDuration(staticFile("audio.mp3"));
```
