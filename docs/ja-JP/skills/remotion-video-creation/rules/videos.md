---
name: videos
description: Remotion への動画埋め込み — トリム、音量、速度、ループ、ピッチ
metadata:
  tags: video, media, trim, volume, speed, loop, pitch
---

# Remotion で動画を使用する

## 前提条件

まず、@remotion/media パッケージをインストールする必要があります。
インストールされていない場合は、以下のコマンドを使用してください。

```bash
npx remotion add @remotion/media # If project uses npm
bunx remotion add @remotion/media # If project uses bun
yarn remotion add @remotion/media # If project uses yarn
pnpm exec remotion add @remotion/media # If project uses pnpm
```

`@remotion/media` の `<Video>` を使用して、コンポジションに動画を埋め込みます。

```tsx
import { Video } from "@remotion/media";
import { staticFile } from "remotion";

export const MyComposition = () => {
  return <Video src={staticFile("video.mp4")} />;
};
```

リモート URL も使用できます。

```tsx
<Video src="https://remotion.media/video.mp4" />
```

## トリミング

`trimBefore` と `trimAfter` で動画の一部を除去します。値は秒単位です。

```tsx
const { fps } = useVideoConfig();

return (
  <Video
    src={staticFile("video.mp4")}
    trimBefore={2 * fps} // 最初の 2 秒をスキップ
    trimAfter={10 * fps} // 10 秒の地点で終了
  />
);
```

## 遅延

`<Sequence>` で動画をラップして、表示タイミングを遅らせます。

```tsx
import { Sequence, staticFile } from "remotion";
import { Video } from "@remotion/media";

const { fps } = useVideoConfig();

return (
  <Sequence from={1 * fps}>
    <Video src={staticFile("video.mp4")} />
  </Sequence>
);
```

動画は 1 秒後に表示されます。

## サイズと位置

`style` プロパティでサイズと位置を制御します。

```tsx
<Video
  src={staticFile("video.mp4")}
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

## 音量

静的な音量（0 から 1）を設定します。

```tsx
<Video src={staticFile("video.mp4")} volume={0.5} />
```

現在のフレームに基づいて動的に音量を変化させるコールバックも使用できます。

```tsx
import { interpolate } from "remotion";

const { fps } = useVideoConfig();

return (
  <Video
    src={staticFile("video.mp4")}
    volume={(f) =>
      interpolate(f, [0, 1 * fps], [0, 1], { extrapolateRight: "clamp" })
    }
  />
);
```

動画を完全にミュートするには `muted` を使用します。

```tsx
<Video src={staticFile("video.mp4")} muted />
```

## 速度

`playbackRate` で再生速度を変更します。

```tsx
<Video src={staticFile("video.mp4")} playbackRate={2} /> {/* 2倍速 */}
<Video src={staticFile("video.mp4")} playbackRate={0.5} /> {/* 0.5倍速 */}
```

逆再生はサポートされていません。

## ループ

`loop` で動画を無限ループします。

```tsx
<Video src={staticFile("video.mp4")} loop />
```

`loopVolumeCurveBehavior` でループ時のフレームカウントの動作を制御します。

- `"repeat"`: ループごとにフレームカウントが 0 にリセットされる（`volume` コールバック向け）
- `"extend"`: フレームカウントが加算され続ける

```tsx
<Video
  src={staticFile("video.mp4")}
  loop
  loopVolumeCurveBehavior="extend"
  volume={(f) => interpolate(f, [0, 300], [1, 0])} // 複数ループにわたってフェードアウト
/>
```

## ピッチ

`toneFrequency` で速度を変えずにピッチを調整します。値の範囲は 0.01 から 2 です。

```tsx
<Video
  src={staticFile("video.mp4")}
  toneFrequency={1.5} // ピッチを上げる
/>
<Video
  src={staticFile("video.mp4")}
  toneFrequency={0.8} // ピッチを下げる
/>
```

ピッチシフトはサーバーサイドレンダリング時にのみ機能します。Remotion Studio のプレビューや `<Player />` では動作しません。
