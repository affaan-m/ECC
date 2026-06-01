---
name: display-captions
description: TikTok スタイルのページとワードハイライトを使った Remotion でのキャプション表示
metadata:
  tags: captions, subtitles, display, tiktok, highlight
---

# Remotion でキャプションを表示する

このガイドでは、`Caption` フォーマットのキャプションデータがすでに用意されていることを前提として、Remotion でキャプションを表示する方法を説明します。

## 前提条件

まず、@remotion/captions パッケージをインストールする必要があります。
インストールされていない場合は、以下のコマンドを使用してください。

```bash
npx remotion add @remotion/captions # npm を使用するプロジェクトの場合
bunx remotion add @remotion/captions # bun を使用するプロジェクトの場合
yarn remotion add @remotion/captions # yarn を使用するプロジェクトの場合
pnpm exec remotion add @remotion/captions # pnpm を使用するプロジェクトの場合
```

## ページの作成

`createTikTokStyleCaptions()` を使用してキャプションをページにグループ化します。`combineTokensWithinMilliseconds` オプションで一度に表示する単語数を制御します。

```tsx
import {useMemo} from 'react';
import {createTikTokStyleCaptions} from '@remotion/captions';
import type {Caption} from '@remotion/captions';

// キャプションを切り替える間隔（ミリ秒）
// 値が大きいほど 1 ページあたりの単語数が増えます
// 値が小さいほど単語数が減ります（より単語ごとの表示に近くなります）
const SWITCH_CAPTIONS_EVERY_MS = 1200;

const {pages} = useMemo(() => {
  return createTikTokStyleCaptions({
    captions,
    combineTokensWithinMilliseconds: SWITCH_CAPTIONS_EVERY_MS,
  });
}, [captions]);
```

## Sequences を使ったレンダリング

ページを反復処理し、各ページを `<Sequence>` でレンダリングします。ページのタイミングから開始フレームと尺を計算します。

```tsx
import {Sequence, useVideoConfig, AbsoluteFill} from 'remotion';
import type {TikTokPage} from '@remotion/captions';

const CaptionedContent: React.FC = () => {
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill>
      {pages.map((page, index) => {
        const nextPage = pages[index + 1] ?? null;
        const startFrame = (page.startMs / 1000) * fps;
        const endFrame = Math.min(
          nextPage ? (nextPage.startMs / 1000) * fps : Infinity,
          startFrame + (SWITCH_CAPTIONS_EVERY_MS / 1000) * fps,
        );
        const durationInFrames = endFrame - startFrame;

        if (durationInFrames <= 0) {
          return null;
        }

        return (
          <Sequence
            key={index}
            from={startFrame}
            durationInFrames={durationInFrames}
          >
            <CaptionPage page={page} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
```

## ワードのハイライト

キャプションページには `tokens` が含まれており、現在発話中の単語をハイライト表示するために使用できます。

```tsx
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {TikTokPage} from '@remotion/captions';

const HIGHLIGHT_COLOR = '#39E508';

const CaptionPage: React.FC<{page: TikTokPage}> = ({page}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // シーケンス開始からの相対的な現在時刻
  const currentTimeMs = (frame / fps) * 1000;
  // ページ開始時刻を加算して絶対時刻に変換
  const absoluteTimeMs = page.startMs + currentTimeMs;

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      <div style={{fontSize: 80, fontWeight: 'bold', whiteSpace: 'pre'}}>
        {page.tokens.map((token) => {
          const isActive =
            token.fromMs <= absoluteTimeMs && token.toMs > absoluteTimeMs;

          return (
            <span
              key={token.fromMs}
              style={{color: isActive ? HIGHLIGHT_COLOR : 'white'}}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
```
