---
name: gif
description: Remotion で GIF、APNG、AVIF、WebP を表示する
metadata:
  tags: gif, animation, images, animated, apng, avif, webp
---

# Remotion でアニメーション画像を使用する

## 基本的な使い方

`<AnimatedImage>` を使用すると、GIF・APNG・AVIF・WebP 画像を Remotion のタイムラインと同期して表示できます。

```tsx
import {AnimatedImage, staticFile} from 'remotion';

export const MyComposition = () => {
  return <AnimatedImage src={staticFile('animation.gif')} width={500} height={500} />;
};
```

リモート URL も使用できます（CORS が有効である必要があります）。

```tsx
<AnimatedImage src="https://example.com/animation.gif" width={500} height={500} />
```

## サイズとフィット

`fit` プロパティでコンテナへの画像の表示方法を制御します。

```tsx
// 引き伸ばして塗りつぶす（デフォルト）
<AnimatedImage src={staticFile("animation.gif")} width={500} height={300} fit="fill" />

// アスペクト比を維持してコンテナ内に収める
<AnimatedImage src={staticFile("animation.gif")} width={500} height={300} fit="contain" />

// コンテナを塗りつぶし、必要に応じてクロップする
<AnimatedImage src={staticFile("animation.gif")} width={500} height={300} fit="cover" />
```

## 再生速度

`playbackRate` でアニメーションの速度を制御します。

```tsx
<AnimatedImage src={staticFile("animation.gif")} width={500} height={500} playbackRate={2} /> {/* 2倍速 */}
<AnimatedImage src={staticFile("animation.gif")} width={500} height={500} playbackRate={0.5} /> {/* 0.5倍速 */}
```

## ループの動作

アニメーション終了時の挙動を制御します。

```tsx
// 無限ループ（デフォルト）
<AnimatedImage src={staticFile("animation.gif")} width={500} height={500} loopBehavior="loop" />

// 1回再生後、最終フレームで停止
<AnimatedImage src={staticFile("animation.gif")} width={500} height={500} loopBehavior="pause-after-finish" />

// 1回再生後、キャンバスをクリア
<AnimatedImage src={staticFile("animation.gif")} width={500} height={500} loopBehavior="clear-after-finish" />
```

## スタイリング

追加の CSS は `style` プロパティで指定します（サイズ指定には `width` および `height` プロパティを使用します）。

```tsx
<AnimatedImage
  src={staticFile('animation.gif')}
  width={500}
  height={500}
  style={{
    borderRadius: 20,
    position: 'absolute',
    top: 100,
    left: 50,
  }}
/>
```

## GIF の再生時間を取得する

`@remotion/gif` の `getGifDurationInSeconds()` を使用して、GIF の再生時間を取得できます。

```bash
npx remotion add @remotion/gif # If project uses npm
bunx remotion add @remotion/gif # If project uses bun
yarn remotion add @remotion/gif # If project uses yarn
pnpm exec remotion add @remotion/gif # If project uses pnpm
```

```tsx
import {getGifDurationInSeconds} from '@remotion/gif';
import {staticFile} from 'remotion';

const duration = await getGifDurationInSeconds(staticFile('animation.gif'));
console.log(duration); // e.g. 2.5
```

GIF の長さに合わせてコンポジションのデュレーションを設定する際に便利です。

```tsx
import {getGifDurationInSeconds} from '@remotion/gif';
import {staticFile, CalculateMetadataFunction} from 'remotion';

const calculateMetadata: CalculateMetadataFunction = async () => {
  const duration = await getGifDurationInSeconds(staticFile('animation.gif'));
  return {
    durationInFrames: Math.ceil(duration * 30),
  };
};
```

## 代替手段

`<AnimatedImage>` が動作しない場合（Chrome と Firefox のみサポート）は、代わりに `@remotion/gif` の `<Gif>` を使用できます。

```bash
npx remotion add @remotion/gif # If project uses npm
bunx remotion add @remotion/gif # If project uses bun
yarn remotion add @remotion/gif # If project uses yarn
pnpm exec remotion add @remotion/gif # If project uses pnpm
```

```tsx
import {Gif} from '@remotion/gif';
import {staticFile} from 'remotion';

export const MyComposition = () => {
  return <Gif src={staticFile('animation.gif')} width={500} height={500} />;
};
```

`<Gif>` コンポーネントは `<AnimatedImage>` と同じプロパティを持ちますが、GIF ファイルのみをサポートします。
