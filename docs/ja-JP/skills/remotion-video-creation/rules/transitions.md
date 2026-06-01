---
name: transitions
description: Remotion のフルスクリーンシーントランジション。
metadata:
  tags: transitions, fade, slide, wipe, scenes
---

## フルスクリーントランジション

`<TransitionSeries>` を使用して、複数のシーンやクリップ間のアニメーションを実現します。
子要素は絶対配置されます。

## 前提条件

まず、@remotion/transitions パッケージをインストールする必要があります。
インストールされていない場合は、以下のコマンドを使用してください。

```bash
npx remotion add @remotion/transitions # If project uses npm
bunx remotion add @remotion/transitions # If project uses bun
yarn remotion add @remotion/transitions # If project uses yarn
pnpm exec remotion add @remotion/transitions # If project uses pnpm
```

## 使用例

```tsx
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneA />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: 15})} />
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneB />
  </TransitionSeries.Sequence>
</TransitionSeries>;
```

## 利用可能なトランジションの種類

各トランジションは対応するモジュールからインポートします。

```tsx
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {wipe} from '@remotion/transitions/wipe';
import {flip} from '@remotion/transitions/flip';
import {clockWipe} from '@remotion/transitions/clock-wipe';
```

## 方向指定のスライドトランジション

入退場アニメーションのスライド方向を指定します。

```tsx
import {slide} from '@remotion/transitions/slide';

<TransitionSeries.Transition presentation={slide({direction: 'from-left'})} timing={linearTiming({durationInFrames: 20})} />;
```

方向: `"from-left"`、`"from-right"`、`"from-top"`、`"from-bottom"`

## タイミングオプション

```tsx
import {linearTiming, springTiming} from '@remotion/transitions';

// 線形タイミング — 一定速度
linearTiming({durationInFrames: 20});

// スプリングタイミング — 有機的な動き
springTiming({config: {damping: 200}, durationInFrames: 25});
```

## デュレーションの計算

トランジションは隣接するシーンに重なるため、コンポジション全体の長さはすべてのシーケンスの合計よりも**短く**なります。

たとえば、2 つの 60 フレームのシーケンスと 15 フレームのトランジションの場合：

- トランジションなし: `60 + 60 = 120` フレーム
- トランジションあり: `60 + 60 - 15 = 105` フレーム

トランジション中は両方のシーンが同時に再生されるため、トランジションのデュレーション分が差し引かれます。

### トランジションのデュレーションを取得する

タイミングオブジェクトの `getDurationInFrames()` メソッドを使用します。

```tsx
import {linearTiming, springTiming} from '@remotion/transitions';

const linearDuration = linearTiming({durationInFrames: 20}).getDurationInFrames({fps: 30});
// 20 を返す

const springDuration = springTiming({config: {damping: 200}}).getDurationInFrames({fps: 30});
// スプリング物理に基づいて計算されたデュレーションを返す
```

明示的な `durationInFrames` なしで `springTiming` を使用する場合、デュレーションはスプリングアニメーションが収束するタイミングを計算するために `fps` に依存します。

### コンポジション全体のデュレーションを計算する

```tsx
import {linearTiming} from '@remotion/transitions';

const scene1Duration = 60;
const scene2Duration = 60;
const scene3Duration = 60;

const timing1 = linearTiming({durationInFrames: 15});
const timing2 = linearTiming({durationInFrames: 20});

const transition1Duration = timing1.getDurationInFrames({fps: 30});
const transition2Duration = timing2.getDurationInFrames({fps: 30});

const totalDuration = scene1Duration + scene2Duration + scene3Duration - transition1Duration - transition2Duration;
// 60 + 60 + 60 - 15 - 20 = 145 フレーム
```
