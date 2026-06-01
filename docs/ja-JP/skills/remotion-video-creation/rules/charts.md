---
name: charts
description: Remotion におけるチャートとデータビジュアライゼーションのパターン。棒グラフ、円グラフ、ヒストグラム、プログレスバー、またはデータ駆動型アニメーションの作成時に使用します。
metadata:
  tags: charts, data, visualization, bar-chart, pie-chart, graphs
---

# Remotion でチャートを作成する

Remotion では、通常の React コード（HTML や SVG）を使用して棒グラフを作成できます。D3.js も利用可能です。

## `useCurrentFrame()` で駆動しないアニメーションの禁止

サードパーティライブラリのすべてのアニメーションを無効にしてください。
レンダリング時にちらつきが発生します。
すべてのアニメーションは `useCurrentFrame()` から駆動してください。

## 棒グラフのアニメーション

基本的な実装例は [Bar Chart Example](assets/charts/bar-chart.tsx) を参照してください。

### 時間差を持つバーのアニメーション

バーの高さにアニメーションを付け、以下のようにスタッガー（時間差）を設定できます。

```tsx
const STAGGER_DELAY = 5;
const frame = useCurrentFrame();
const {fps} = useVideoConfig();

const bars = data.map((item, i) => {
  const delay = i * STAGGER_DELAY;
  const height = spring({
    frame,
    fps,
    delay,
    config: {damping: 200},
  });
  return <div style={{height: height * item.value}} />;
});
```

## 円グラフのアニメーション

stroke-dashoffset を使用してセグメントをアニメーションさせ、12 時の位置から開始します。

```tsx
const frame = useCurrentFrame();
const {fps} = useVideoConfig();

const progress = interpolate(frame, [0, 100], [0, 1]);

const circumference = 2 * Math.PI * radius;
const segmentLength = (value / total) * circumference;
const offset = interpolate(progress, [0, 1], [segmentLength, 0]);

<circle r={radius} cx={center} cy={center} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={`${segmentLength} ${circumference}`} strokeDashoffset={offset} transform={`rotate(-90 ${center} ${center})`} />;
```
