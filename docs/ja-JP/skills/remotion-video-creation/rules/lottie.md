---
name: lottie
description: Remotion に Lottie アニメーションを埋め込む。
metadata:
  category: Animation
---

# Remotion で Lottie アニメーションを使用する

## 前提条件

まず、@remotion/lottie パッケージをインストールする必要があります。
インストールされていない場合は、以下のコマンドを使用してください。

```bash
npx remotion add @remotion/lottie # If project uses npm
bunx remotion add @remotion/lottie # If project uses bun
yarn remotion add @remotion/lottie # If project uses yarn
pnpm exec remotion add @remotion/lottie # If project uses pnpm
```

## Lottie ファイルを表示する

Lottie アニメーションをインポートするには、次の手順に従います。

- Lottie アセットをフェッチする
- 読み込み処理を `delayRender()` と `continueRender()` でラップする
- アニメーションデータをステートに保存する
- `@remotion/lottie` パッケージの `Lottie` コンポーネントでアニメーションをレンダリングする

```tsx
import {Lottie, LottieAnimationData} from '@remotion/lottie';
import {useEffect, useState} from 'react';
import {cancelRender, continueRender, delayRender} from 'remotion';

export const MyAnimation = () => {
  const [handle] = useState(() => delayRender('Loading Lottie animation'));

  const [animationData, setAnimationData] = useState<LottieAnimationData | null>(null);

  useEffect(() => {
    fetch('https://assets4.lottiefiles.com/packages/lf20_zyquagfl.json')
      .then((data) => data.json())
      .then((json) => {
        setAnimationData(json);
        continueRender(handle);
      })
      .catch((err) => {
        cancelRender(err);
      });
  }, [handle]);

  if (!animationData) {
    return null;
  }

  return <Lottie animationData={animationData} />;
};
```

## スタイリングとアニメーション

Lottie は `style` プロパティによるスタイルとアニメーションをサポートします。

```tsx
return <Lottie animationData={animationData} style={{width: 400, height: 400}} />;
```
