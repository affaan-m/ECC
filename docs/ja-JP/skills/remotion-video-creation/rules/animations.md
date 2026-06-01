---
name: animations
description: Remotion における基本的なアニメーションスキル
metadata:
  tags: animations, transitions, frames, useCurrentFrame
---

すべてのアニメーションは `useCurrentFrame()` フックで駆動しなければなりません。
アニメーションは秒単位で記述し、`useVideoConfig()` から取得した `fps` の値を掛け合わせて使用します。

```tsx
import { useCurrentFrame } from "remotion";

export const FadeIn = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, 2 * fps], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{ opacity }}>Hello World!</div>
  );
};
```

CSS のトランジションやアニメーションは禁止されています。正しくレンダリングされません。
Tailwind のアニメーションクラス名は禁止されています。正しくレンダリングされません。
