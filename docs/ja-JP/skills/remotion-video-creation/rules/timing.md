---
name: timing
description: Remotion の補間カーブ — 線形、イージング、スプリングアニメーション
metadata:
  tags: spring, bounce, easing, interpolation
---

単純な線形補間には `interpolate` 関数を使用します。

```ts title="Going from 0 to 1 over 100 frames"
import {interpolate} from 'remotion';

const opacity = interpolate(frame, [0, 100], [0, 1]);
```

デフォルトでは値はクランプされないため、[0, 1] の範囲外の値になる場合があります。
クランプする方法は以下のとおりです。

```ts title="Going from 0 to 1 over 100 frames with extrapolation"
const opacity = interpolate(frame, [0, 100], [0, 1], {
  extrapolateRight: 'clamp',
  extrapolateLeft: 'clamp',
});
```

## スプリングアニメーション

スプリングアニメーションはより自然な動きを実現します。
時間の経過とともに 0 から 1 に変化します。

```ts title="Spring animation from 0 to 1 over 100 frames"
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';

const frame = useCurrentFrame();
const {fps} = useVideoConfig();

const scale = spring({
  frame,
  fps,
});
```

### 物理プロパティ

デフォルト設定は `mass: 1, damping: 10, stiffness: 100` です。
この設定では、アニメーションが落ち着く前に少しバウンスします。

設定は次のように上書きできます。

```ts
const scale = spring({
  frame,
  fps,
  config: {damping: 200},
});
```

バウンスなしの自然な動きには `{ damping: 200 }` を推奨します。

よく使われる設定を以下に示します。

```tsx
const smooth = {damping: 200}; // 滑らか、バウンスなし（控えめな表示に）
const snappy = {damping: 20, stiffness: 200}; // キビキビ、バウンス最小（UI 要素に）
const bouncy = {damping: 8}; // バウンスあり（遊び心のあるアニメーションに）
const heavy = {damping: 15, stiffness: 80, mass: 2}; // 重い、遅い、小さなバウンス
```

### 遅延

デフォルトではアニメーションはすぐに開始されます。
`delay` パラメータを使用して、指定したフレーム数だけ開始を遅らせることができます。

```tsx
const entrance = spring({
  frame: frame - ENTRANCE_DELAY,
  fps,
  delay: 20,
});
```

### デュレーション

`spring()` は物理プロパティに基づいた自然なデュレーションを持ちます。
特定のデュレーションに引き伸ばすには `durationInFrames` パラメータを使用します。

```tsx
const spring = spring({
  frame,
  fps,
  durationInFrames: 40,
});
```

### spring() と interpolate() の組み合わせ

スプリングの出力（0〜1）をカスタム範囲にマッピングします。

```tsx
const springProgress = spring({
  frame,
  fps,
});

// 回転にマッピング
const rotation = interpolate(springProgress, [0, 1], [0, 360]);

<div style={{rotate: rotation + 'deg'}} />;
```

### スプリングの合算

スプリングは単なる数値を返すため、計算に利用できます。

```tsx
const frame = useCurrentFrame();
const {fps, durationInFrames} = useVideoConfig();

const inAnimation = spring({
  frame,
  fps,
});
const outAnimation = spring({
  frame,
  fps,
  durationInFrames: 1 * fps,
  delay: durationInFrames - 1 * fps,
});

const scale = inAnimation - outAnimation;
```

## イージング

`interpolate` 関数にイージングを追加できます。

```ts
import {interpolate, Easing} from 'remotion';

const value1 = interpolate(frame, [0, 100], [0, 1], {
  easing: Easing.inOut(Easing.quad),
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});
```

デフォルトのイージングは `Easing.linear` です。
以下のようなさまざまな凸性が用意されています。

- `Easing.in` — ゆっくり始まり加速する
- `Easing.out` — 速く始まりゆっくりになる
- `Easing.inOut`

カーブ（線形に近い順）：

- `Easing.quad`
- `Easing.sin`
- `Easing.exp`
- `Easing.circle`

凸性とカーブを組み合わせてイージング関数を作成します。

```ts
const value1 = interpolate(frame, [0, 100], [0, 1], {
  easing: Easing.inOut(Easing.quad),
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});
```

3 次ベジェ曲線もサポートされています。

```ts
const value1 = interpolate(frame, [0, 100], [0, 1], {
  easing: Easing.bezier(0.8, 0.22, 0.96, 0.65),
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});
```
