---
name: compositions
description: コンポジション、スティル、フォルダ、デフォルトプロップ、動的メタデータの定義
metadata:
  tags: composition, still, folder, props, metadata
---

`<Composition>` は、レンダリング可能な動画のコンポーネント、幅、高さ、fps、尺を定義します。

通常は `src/Root.tsx` ファイルに配置します。

```tsx
import { Composition } from "remotion";
import { MyComposition } from "./MyComposition";

export const RemotionRoot = () => {
  return (
    <Composition
      id="MyComposition"
      component={MyComposition}
      durationInFrames={100}
      fps={30}
      width={1080}
      height={1080}
    />
  );
};
```

## デフォルトプロップ

`defaultProps` を渡して、コンポーネントの初期値を設定します。
値は JSON シリアライズ可能である必要があります（`Date`、`Map`、`Set`、`staticFile()` はサポートされています）。

```tsx
import { Composition } from "remotion";
import { MyComposition, MyCompositionProps } from "./MyComposition";

export const RemotionRoot = () => {
  return (
    <Composition
      id="MyComposition"
      component={MyComposition}
      durationInFrames={100}
      fps={30}
      width={1080}
      height={1080}
      defaultProps={{
        title: "Hello World",
        color: "#ff0000",
      } satisfies MyCompositionProps}
    />
  );
};
```

`defaultProps` の型安全性を確保するため、プロップには `interface` ではなく `type` 宣言を使用してください。

## フォルダ

`<Folder>` を使用して、サイドバーでコンポジションを整理します。
フォルダ名には英字、数字、ハイフンのみ使用できます。

```tsx
import { Composition, Folder } from "remotion";

export const RemotionRoot = () => {
  return (
    <>
      <Folder name="Marketing">
        <Composition id="Promo" /* ... */ />
        <Composition id="Ad" /* ... */ />
      </Folder>
      <Folder name="Social">
        <Folder name="Instagram">
          <Composition id="Story" /* ... */ />
          <Composition id="Reel" /* ... */ />
        </Folder>
      </Folder>
    </>
  );
};
```

## スティル

単一フレームの画像には `<Still>` を使用します。`durationInFrames` や `fps` は不要です。

```tsx
import { Still } from "remotion";
import { Thumbnail } from "./Thumbnail";

export const RemotionRoot = () => {
  return (
    <Still
      id="Thumbnail"
      component={Thumbnail}
      width={1280}
      height={720}
    />
  );
};
```

## メタデータの計算

`calculateMetadata` を使用して、データに基づいてサイズ、尺、プロップを動的に変更します。

```tsx
import { Composition, CalculateMetadataFunction } from "remotion";
import { MyComposition, MyCompositionProps } from "./MyComposition";

const calculateMetadata: CalculateMetadataFunction<MyCompositionProps> = async ({
  props,
  abortSignal,
}) => {
  const data = await fetch(`https://api.example.com/video/${props.videoId}`, {
    signal: abortSignal,
  }).then((res) => res.json());

  return {
    durationInFrames: Math.ceil(data.duration * 30),
    props: {
      ...props,
      videoUrl: data.url,
    },
  };
};

export const RemotionRoot = () => {
  return (
    <Composition
      id="MyComposition"
      component={MyComposition}
      durationInFrames={100} // プレースホルダー。上書きされます
      fps={30}
      width={1080}
      height={1080}
      defaultProps={{ videoId: "abc123" }}
      calculateMetadata={calculateMetadata}
    />
  );
};
```

この関数は `props`、`durationInFrames`、`width`、`height`、`fps`、およびコーデック関連のデフォルト値を返すことができます。レンダリング開始前に一度だけ実行されます。
