---
name: audio
description: Remotion での音声・サウンドの使用 — インポート、トリミング、音量、速度、ピッチ
metadata:
  tags: audio, media, trim, volume, speed, loop, pitch, mute, sound, sfx
---

# Remotion で音声を使用する

## 前提条件

まず、@remotion/media パッケージをインストールする必要があります。
インストールされていない場合は、以下のコマンドを使用してください。

```bash
npx remotion add @remotion/media # npm を使用するプロジェクトの場合
bunx remotion add @remotion/media # bun を使用するプロジェクトの場合
yarn remotion add @remotion/media # yarn を使用するプロジェクトの場合
pnpm exec remotion add @remotion/media # pnpm を使用するプロジェクトの場合
```

## 音声のインポート

`@remotion/media` の `<Audio>` を使用して、コンポジションに音声を追加します。

```tsx
import { Audio } from "@remotion/media";
import { staticFile } from "remotion";

export const MyComposition = () => {
  return <Audio src={staticFile("audio.mp3")} />;
};
```

リモート URL も使用できます。

```tsx
<Audio src="https://remotion.media/audio.mp3" />
```

デフォルトでは、音声は最初から全音量・全長で再生されます。
複数の `<Audio>` コンポーネントを追加することで、音声トラックを重ねることができます。

## トリミング

`trimBefore` と `trimAfter` を使用して音声の一部を除去します。値はフレーム単位です。

```tsx
const { fps } = useVideoConfig();

return (
  <Audio
    src={staticFile("audio.mp3")}
    trimBefore={2 * fps} // 最初の 2 秒をスキップ
    trimAfter={10 * fps} // 10 秒地点で終了
  />
);
```

音声はコンポジションの先頭から再生を開始しますが、指定した区間のみが再生されます。

## 遅延再生

音声を `<Sequence>` でラップして、再生開始のタイミングを遅らせます。

```tsx
import { Sequence, staticFile } from "remotion";
import { Audio } from "@remotion/media";

const { fps } = useVideoConfig();

return (
  <Sequence from={1 * fps}>
    <Audio src={staticFile("audio.mp3")} />
  </Sequence>
);
```

音声は 1 秒後に再生が始まります。

## 音量

静的な音量（0 〜 1）を設定する場合：

```tsx
<Audio src={staticFile("audio.mp3")} volume={0.5} />
```

現在のフレームに基づいて動的に音量を変化させる場合はコールバックを使用します。

```tsx
import { interpolate } from "remotion";

const { fps } = useVideoConfig();

return (
  <Audio
    src={staticFile("audio.mp3")}
    volume={(f) =>
      interpolate(f, [0, 1 * fps], [0, 1], { extrapolateRight: "clamp" })
    }
  />
);
```

`f` の値は、コンポジションのフレームではなく、音声の再生開始時点を 0 として始まります。

## ミュート

`muted` を使用して音声を無音にします。動的に設定することも可能です。

```tsx
const frame = useCurrentFrame();
const { fps } = useVideoConfig();

return (
  <Audio
    src={staticFile("audio.mp3")}
    muted={frame >= 2 * fps && frame <= 4 * fps} // 2 秒〜 4 秒間をミュート
  />
);
```

## 速度

`playbackRate` を使用して再生速度を変更します。

```tsx
<Audio src={staticFile("audio.mp3")} playbackRate={2} /> {/* 2 倍速 */}
<Audio src={staticFile("audio.mp3")} playbackRate={0.5} /> {/* 0.5 倍速 */}
```

逆再生はサポートされていません。

## ループ

`loop` を使用して音声を無限にループさせます。

```tsx
<Audio src={staticFile("audio.mp3")} loop />
```

`loopVolumeCurveBehavior` を使用して、ループ時のフレームカウントの動作を制御します。

- `"repeat"`: 各ループでフレームカウントが 0 にリセットされます（デフォルト）
- `"extend"`: フレームカウントが連続して増加し続けます

```tsx
<Audio
  src={staticFile("audio.mp3")}
  loop
  loopVolumeCurveBehavior="extend"
  volume={(f) => interpolate(f, [0, 300], [1, 0])} // 複数ループにわたってフェードアウト
/>
```

## ピッチ

`toneFrequency` を使用して速度を変えずにピッチを調整します。値の範囲は 0.01 〜 2 です。

```tsx
<Audio
  src={staticFile("audio.mp3")}
  toneFrequency={1.5} // ピッチを上げる
/>
<Audio
  src={staticFile("audio.mp3")}
  toneFrequency={0.8} // ピッチを下げる
/>
```

ピッチシフトはサーバーサイドレンダリング時のみ機能します。Remotion Studio のプレビューや `<Player />` では動作しません。
