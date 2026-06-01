---
name: measuring-dom-nodes
description: Remotion で DOM 要素の寸法を計測する
metadata:
  tags: measure, layout, dimensions, getBoundingClientRect, scale
---

# Remotion での DOM ノードの計測

Remotion はビデオコンテナに `scale()` トランスフォームを適用するため、`getBoundingClientRect()` から得られる値に影響を与えます。正確な計測値を得るには `useCurrentScale()` を使用してください。

## 要素の寸法を計測する

```tsx
import { useCurrentScale } from "remotion";
import { useRef, useEffect, useState } from "react";

export const MyComponent = () => {
  const ref = useRef<HTMLDivElement>(null);
  const scale = useCurrentScale();
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setDimensions({
      width: rect.width / scale,
      height: rect.height / scale,
    });
  }, [scale]);

  return <div ref={ref}>Content to measure</div>;
};
```
