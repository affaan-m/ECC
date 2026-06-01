---
name: calculate-metadata
description: コンポジションの尺、サイズ、プロップを動的に設定する
metadata:
  tags: calculateMetadata, duration, dimensions, props, dynamic
---

# calculateMetadata の使用

`<Composition>` に `calculateMetadata` を使用することで、レンダリング前に尺・サイズ・プロップを動的に設定・変換できます。

```tsx
<Composition id="MyComp" component={MyComponent} durationInFrames={300} fps={30} width={1920} height={1080} defaultProps={{videoSrc: 'https://remotion.media/video.mp4'}} calculateMetadata={calculateMetadata} />
```

## 動画に基づく尺の設定

mediabunny/metadata スキルの `getMediaMetadata()` 関数を使用して動画の尺を取得します。

```tsx
import {CalculateMetadataFunction} from 'remotion';
import {getMediaMetadata} from '../get-media-metadata';

const calculateMetadata: CalculateMetadataFunction<Props> = async ({props}) => {
  const {durationInSeconds} = await getMediaMetadata(props.videoSrc);

  return {
    durationInFrames: Math.ceil(durationInSeconds * 30),
  };
};
```

## 動画のサイズに合わせた設定

```tsx
const calculateMetadata: CalculateMetadataFunction<Props> = async ({props}) => {
  const {durationInSeconds, dimensions} = await getMediaMetadata(props.videoSrc);

  return {
    durationInFrames: Math.ceil(durationInSeconds * 30),
    width: dimensions?.width ?? 1920,
    height: dimensions?.height ?? 1080,
  };
};
```

## 複数の動画に基づく尺の設定

```tsx
const calculateMetadata: CalculateMetadataFunction<Props> = async ({props}) => {
  const metadataPromises = props.videos.map((video) => getMediaMetadata(video.src));
  const allMetadata = await Promise.all(metadataPromises);

  const totalDuration = allMetadata.reduce((sum, meta) => sum + meta.durationInSeconds, 0);

  return {
    durationInFrames: Math.ceil(totalDuration * 30),
  };
};
```

## デフォルト出力ファイル名の設定

プロップに基づいてデフォルトの出力ファイル名を設定します。

```tsx
const calculateMetadata: CalculateMetadataFunction<Props> = async ({props}) => {
  return {
    defaultOutName: `video-${props.id}.mp4`,
  };
};
```

## プロップの変換

レンダリング前にデータを取得したり、プロップを変換したりします。

```tsx
const calculateMetadata: CalculateMetadataFunction<Props> = async ({props, abortSignal}) => {
  const response = await fetch(props.dataUrl, {signal: abortSignal});
  const data = await response.json();

  return {
    props: {
      ...props,
      fetchedData: data,
    },
  };
};
```

`abortSignal` は、Studio でプロップが変更された際に古いリクエストをキャンセルします。

## 戻り値

すべてのフィールドはオプションです。返された値は `<Composition>` のプロップを上書きします。

- `durationInFrames`: フレーム数
- `width`: コンポジションの幅（ピクセル）
- `height`: コンポジションの高さ（ピクセル）
- `fps`: フレームレート（秒あたりのフレーム数）
- `props`: コンポーネントに渡す変換済みプロップ
- `defaultOutName`: デフォルトの出力ファイル名
- `defaultCodec`: レンダリングに使用するデフォルトコーデック
