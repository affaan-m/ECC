---
name: trimming
description: Remotion のトリムパターン — アニメーションの先頭または末尾をカットする
metadata:
  tags: sequence, trim, clip, cut, offset
---

負の `from` 値を持つ `<Sequence>` を使用して、アニメーションの先頭をトリムします。

## 先頭のトリム

負の `from` 値は時間を逆方向にシフトし、アニメーションを途中から開始させます。

```tsx
import { Sequence, useVideoConfig } from "remotion";

const fps = useVideoConfig();

<Sequence from={-0.5 * fps}>
  <MyAnimation />
</Sequence>
```

アニメーションは 15 フレーム進んだ状態から始まり、最初の 15 フレームがトリムされます。
`<MyAnimation>` の内部では、`useCurrentFrame()` は 0 ではなく 15 から始まります。

## 末尾のトリム

`durationInFrames` を使用して、指定したデュレーション後にコンテンツをアンマウントします。

```tsx

<Sequence durationInFrames={1.5 * fps}>
  <MyAnimation />
</Sequence>
```

アニメーションは 45 フレーム再生された後、コンポーネントがアンマウントされます。

## トリムと遅延の組み合わせ

シーケンスをネストすることで、先頭のトリムと表示の遅延を同時に実現できます。

```tsx
<Sequence from={30}>
  <Sequence from={-15}>
    <MyAnimation />
  </Sequence>
</Sequence>
```

内側のシーケンスが先頭から 15 フレームをトリムし、外側のシーケンスが結果を 30 フレーム遅らせます。
