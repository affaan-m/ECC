---
name: assets
description: Remotion への画像、動画、音声、フォントのインポート
metadata:
  tags: assets, staticFile, images, fonts, public
---

# Remotion でアセットをインポートする

## public フォルダ

プロジェクトルートの `public/` フォルダにアセットを配置してください。

## staticFile() の使用

`public/` フォルダ内のファイルを参照する場合は、必ず `staticFile()` を使用してください。

```tsx
import {Img, staticFile} from 'remotion';

export const MyComposition = () => {
  return <Img src={staticFile('logo.png')} />;
};
```

この関数は、サブディレクトリへのデプロイ時にも正しく動作するエンコードされた URL を返します。

## コンポーネントとの組み合わせ

**画像:**

```tsx
import {Img, staticFile} from 'remotion';

<Img src={staticFile('photo.png')} />;
```

**動画:**

```tsx
import {Video} from '@remotion/media';
import {staticFile} from 'remotion';

<Video src={staticFile('clip.mp4')} />;
```

**音声:**

```tsx
import {Audio} from '@remotion/media';
import {staticFile} from 'remotion';

<Audio src={staticFile('music.mp3')} />;
```

**フォント:**

```tsx
import {staticFile} from 'remotion';

const fontFamily = new FontFace('MyFont', `url(${staticFile('font.woff2')})`);
await fontFamily.load();
document.fonts.add(fontFamily);
```

## リモート URL

リモート URL は `staticFile()` を使わずに直接指定できます。

```tsx
<Img src="https://example.com/image.png" />
<Video src="https://remotion.media/video.mp4" />
```

## 重要事項

- Remotion コンポーネント（`<Img>`、`<Video>`、`<Audio>`）は、レンダリング前にアセットが完全にロードされるまで待機します
- ファイル名に含まれる特殊文字（`#`、`?`、`&`）は自動的にエンコードされます
