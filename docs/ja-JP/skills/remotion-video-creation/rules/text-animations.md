---
name: text-animations
description: Remotion におけるタイポグラフィとテキストアニメーションのパターン。
metadata:
  tags: typography, text, typewriter, highlighter ken
---

## テキストアニメーション

`useCurrentFrame()` を基に、文字列を 1 文字ずつ切り出すことでタイプライター効果を実現します。

## タイプライター効果

点滅カーソルや最初の文章後のポーズを含む高度な例については、[Typewriter](assets/text-animations-typewriter.tsx) を参照してください。

タイプライター効果には必ず文字列のスライスを使用してください。文字ごとの透明度による実装は行わないでください。

## 単語のハイライト

蛍光ペンでなぞるような単語ハイライトのアニメーション例については、[Word Highlight](assets/text-animations-word-highlight.tsx) を参照してください。
