---
name: import-srt-captions
description: @remotion/captions を使って .srt 字幕ファイルを Remotion にインポートする
metadata:
  tags: captions, subtitles, srt, import, parse
---

# Remotion への .srt 字幕インポート

既存の `.srt` 字幕ファイルがある場合は、`@remotion/captions` の `parseSrt()` を使って Remotion にインポートできます。

## 前提条件

まず、@remotion/captions パッケージをインストールする必要があります。
インストールされていない場合は、以下のコマンドを使用してください。

```bash
npx remotion add @remotion/captions # If project uses npm
bunx remotion add @remotion/captions # If project uses bun
yarn remotion add @remotion/captions # If project uses yarn
pnpm exec remotion add @remotion/captions # If project uses pnpm
```

## .srt ファイルの読み込み

`staticFile()` で `public` フォルダ内の `.srt` ファイルを参照し、フェッチしてパースします。

```tsx
import {useState, useEffect, useCallback} from 'react';
import {AbsoluteFill, staticFile, useDelayRender} from 'remotion';
import {parseSrt} from '@remotion/captions';
import type {Caption} from '@remotion/captions';

export const MyComponent: React.FC = () => {
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const {delayRender, continueRender, cancelRender} = useDelayRender();
  const [handle] = useState(() => delayRender());

  const fetchCaptions = useCallback(async () => {
    try {
      const response = await fetch(staticFile('subtitles.srt'));
      const text = await response.text();
      const {captions: parsed} = parseSrt({input: text});
      setCaptions(parsed);
      continueRender(handle);
    } catch (e) {
      cancelRender(e);
    }
  }, [continueRender, cancelRender, handle]);

  useEffect(() => {
    fetchCaptions();
  }, [fetchCaptions]);

  if (!captions) {
    return null;
  }

  return <AbsoluteFill>{/* キャプションをここで使用する */}</AbsoluteFill>;
};
```

リモート URL も使用できます。`staticFile()` の代わりに URL を指定して `fetch()` してください。

## インポートしたキャプションの利用

パース後のキャプションは `Caption` 形式となっており、`@remotion/captions` のすべてのユーティリティで使用できます。
