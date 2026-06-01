---
name: sequencing
description: Remotion のシーケンスパターン — 遅延、トリム、アイテムの表示時間制限
metadata:
  tags: sequence, series, timing, delay, trim
---

`<Sequence>` を使用して、タイムライン上で要素が表示されるタイミングを遅らせます。

```tsx
import { Sequence } from "remotion";

const {fps} = useVideoConfig();

<Sequence from={1 * fps} durationInFrames={2 * fps} premountFor={1 * fps}>
  <Title />
</Sequence>
<Sequence from={2 * fps} durationInFrames={2 * fps} premountFor={1 * fps}>
  <Subtitle />
</Sequence>
```

デフォルトでは、コンポーネントは絶対配置のフィル要素でラップされます。
ラップが不要な場合は `layout` プロパティを使用してください。

```tsx
<Sequence layout="none">
  <Title />
</Sequence>
```

## プリマウント

これにより、コンポーネントが実際に再生される前にタイムライン上で読み込まれます。
`<Sequence>` には必ずプリマウントを設定してください。

```tsx
<Sequence premountFor={1 * fps}>
  <Title />
</Sequence>
```

## シリーズ

要素をオーバーラップなしで順番に再生する場合は `<Series>` を使用します。

```tsx
import {Series} from 'remotion';

<Series>
  <Series.Sequence durationInFrames={45}>
    <Intro />
  </Series.Sequence>
  <Series.Sequence durationInFrames={60}>
    <MainContent />
  </Series.Sequence>
  <Series.Sequence durationInFrames={30}>
    <Outro />
  </Series.Sequence>
</Series>;
```

`<Sequence>` と同様に、`<Series.Sequence>` のアイテムもデフォルトで絶対配置のフィル要素でラップされます。`layout` プロパティを `none` に設定すると無効にできます。

### オーバーラップするシリーズ

負のオフセットを使用して、シーケンスを重ねて再生します。

```tsx
<Series>
  <Series.Sequence durationInFrames={60}>
    <SceneA />
  </Series.Sequence>
  <Series.Sequence offset={-15} durationInFrames={60}>
    {/* SceneA が終了する 15 フレーム前に開始 */}
    <SceneB />
  </Series.Sequence>
</Series>
```

## Sequence 内のフレーム参照

Sequence の内部では、`useCurrentFrame()` はローカルフレーム（0 から始まる）を返します。

```tsx
<Sequence from={60} durationInFrames={30}>
  <MyComponent />
  {/* MyComponent 内で useCurrentFrame() は 60〜89 ではなく 0〜29 を返す */}
</Sequence>
```

## ネストされた Sequence

複雑なタイミングにはシーケンスのネストを活用します。

```tsx
<Sequence from={0} durationInFrames={120}>
  <Background />
  <Sequence from={15} durationInFrames={90} layout="none">
    <Title />
  </Sequence>
  <Sequence from={45} durationInFrames={60} layout="none">
    <Subtitle />
  </Sequence>
</Sequence>
```
