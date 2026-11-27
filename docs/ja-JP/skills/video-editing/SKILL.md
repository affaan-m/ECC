---
name: video-editing
description: 実写素材のカット、構築、強化のためのAI支援ビデオ編集ワークフロー。生の撮影素材からFFmpeg、Remotion、ElevenLabs、fal.aiを経て、DescriptまたはCapCutで最終仕上げを行う完全なパイプラインをカバーする。ユーザーがビデオの編集、素材のカット、vlogの作成、またはビデオコンテンツの構築を望む場合に使用する。
origin: ECC
---

# ビデオ編集

実際の素材に対するAI支援編集。プロンプトからの生成ではない。既存のビデオを素早く編集する。

## 有効化する場面

* ユーザーがビデオ素材の編集、カット、または構築をしたい
* 長い録音を短いビデオコンテンツに変換する
* 生の素材からvlog、チュートリアル、またはデモビデオを構築する
* 既存のビデオにオーバーレイ、字幕、音楽、またはナレーションを追加する
* 異なるプラットフォーム（YouTube、TikTok、Instagram）用にビデオを再フレーミングする
* ユーザーが「ビデオを編集する」「この素材をカットする」「vlogを作る」「ビデオワークフロー」と言及している

## コアフィロソフィー

AIにビデオ全体を作成させることをやめ、実際の素材を圧縮・構築・強化するために使い始めると、AI動画編集が役立つようになる。価値は生成にあるのではない。価値は圧縮にある。

## 処理パイプライン

```
Screen Studio / 生の素材
  → Claude / Codex
  → FFmpeg
  → Remotion
  → ElevenLabs / fal.ai
  → Descript または CapCut
```

各レイヤーには特定の役割がある。レイヤーをスキップしない。1つのツールですべてをやろうとしない。

## レイヤー1：収集（Screen Studio / 生の素材）

ソース素材を収集する：

* **Screen Studio**：アプリのデモ、コーディングセッション、ブラウザワークフロー向けの洗練されたスクリーンレコーディング
* **生のカメラ素材**：vlog素材、インタビュー、イベント録画
* **VideoDBによるデスクトップキャプチャ**：リアルタイムコンテキストを伴うセッション録画（`videodb` スキル参照）

出力：整理準備ができた生のファイル。

## レイヤー2：整理（Claude / Codex）

Claude CodeまたはCodexを使用して：

* **転写とタグ付け**：トランスクリプトを生成し、トピックとキーポイントを特定する
* **構造の計画**：保持するもの、カットするもの、順序を決定する
* **無効なセグメントの特定**：ポーズ、脱線、テイクの繰り返しを見つける
* **編集決定リストの生成**：カット用のタイムスタンプ、保持するセグメント
* **FFmpegとRemotionコードのスキャフォールディング**：コマンドとコンポジションを生成する

```
プロンプトの例：
「これは4時間の録音のトランスクリプトです。24分のvlogに最適な8つのハイライトを見つけてください。
各セグメントにFFmpegカットコマンドを提供してください。」
```

このレイヤーは構造に関するものであり、最終的なクリエイティブな判断ではない。

## レイヤー3：決定論的カット（FFmpeg）

FFmpegは退屈だが重要な作業を処理する：分割、トリミング、結合、前処理。

### タイムスタンプでセグメントを抽出する

```bash
ffmpeg -i raw.mp4 -ss 00:12:30 -to 00:15:45 -c copy segment_01.mp4
```

### 編集決定リストに基づくバッチカット

```bash
#!/bin/bash
# cuts.txt: start,end,label
while IFS=, read -r start end label; do
  ffmpeg -i raw.mp4 -ss "$start" -to "$end" -c copy "segments/${label}.mp4"
done < cuts.txt
```

### セグメントを結合する

```bash
# Create file list
for f in segments/*.mp4; do echo "file '$f'"; done > concat.txt
ffmpeg -f concat -safe 0 -i concat.txt -c copy assembled.mp4
```

### 編集を高速化するためのプロキシファイルを作成する

```bash
ffmpeg -i raw.mp4 -vf "scale=960:-2" -c:v libx264 -preset ultrafast -crf 28 proxy.mp4
```

### 転写用に音声を抽出する

```bash
ffmpeg -i raw.mp4 -vn -acodec pcm_s16le -ar 16000 audio.wav
```

### 音声レベルを正規化する

```bash
ffmpeg -i segment.mp4 -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:v copy normalized.mp4
```

## レイヤー4：プログラマブルコンポジション（Remotion）

Remotionは編集問題をコンポーザブルなコードに変換する。従来のエディタでは面倒なことに使用する：

### Remotionを使用する場面

* オーバーレイ：テキスト、画像、ブランドロゴ、ローワーサード
* データビジュアライゼーション：チャート、統計、アニメーション数値
* モーショングラフィックス：トランジション、説明アニメーション
* コンポーザブルシーン：ビデオ間で再利用可能なテンプレート
* 製品デモ：注釈付きスクリーンショット、UIハイライト

### 基本的なRemotionコンポジション

```tsx
import { AbsoluteFill, Sequence, Video, useCurrentFrame } from "remotion";

export const VlogComposition: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill>
      {/* Main footage */}
      <Sequence from={0} durationInFrames={300}>
        <Video src="/segments/intro.mp4" />
      </Sequence>

      {/* Title overlay */}
      <Sequence from={30} durationInFrames={90}>
        <AbsoluteFill style={{
          justifyContent: "center",
          alignItems: "center",
        }}>
          <h1 style={{
            fontSize: 72,
            color: "white",
            textShadow: "2px 2px 8px rgba(0,0,0,0.8)",
          }}>
            The AI Editing Stack
          </h1>
        </AbsoluteFill>
      </Sequence>

      {/* Next segment */}
      <Sequence from={300} durationInFrames={450}>
        <Video src="/segments/demo.mp4" />
      </Sequence>
    </AbsoluteFill>
  );
};
```

### 出力をレンダリングする

```bash
npx remotion render src/index.ts VlogComposition output.mp4
```

詳細なパターンとAPIリファレンスについては[Remotionドキュメント](https://www.remotion.dev/docs)を参照する。

## レイヤー5：生成アセット（ElevenLabs / fal.ai）

必要なものだけを生成する。ビデオ全体を生成しない。

### ElevenLabsでのナレーション

```python
import os
import requests

resp = requests.post(
    f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
    headers={
        "xi-api-key": os.environ["ELEVENLABS_API_KEY"],
        "Content-Type": "application/json"
    },
    json={
        "text": "Your narration text here",
        "model_id": "eleven_turbo_v2_5",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}
    }
)
with open("voiceover.mp3", "wb") as f:
    f.write(resp.content)
```

### fal.aiでの音楽と効果音の生成

`fal-ai-media` スキルを以下に使用する：

* バックグラウンドミュージック生成
* 効果音（ビデオからオーディオへのThinkSoundモデル）
* トランジション効果音

### fal.aiでのビジュアル生成

存在しないカットアウェイ、サムネイル、またはBロール素材に使用する：

```
generate(app_id: "fal-ai/nano-banana-pro", input_data: {
  "prompt": "プロフェッショナルなテクビデオサムネイル、暗い背景、画面上にコード",
  "image_size": "landscape_16_9"
})
```

### VideoDBによる生成オーディオ

VideoDBが設定されている場合：

```python
voiceover = coll.generate_voice(text="Narration here", voice="alloy")
music = coll.generate_music(prompt="lo-fi background for coding vlog", duration=120)
sfx = coll.generate_sound_effect(prompt="subtle whoosh transition")
```

## レイヤー6：最終仕上げ（Descript / CapCut）

最後のレイヤーは人間が行う。従来のエディタを使用して：

* **ペーシング調整**：速すぎたり遅すぎると感じるカットを調整する
* **字幕**：自動生成してから手動でクリーンアップする
* **カラーグレーディング**：基本的な補正とムード調整
* **最終オーディオミックス**：ボイス、音楽、効果音のレベルをバランスする
* **エクスポート**：プラットフォーム固有のフォーマットと品質設定

ここにセンスが現れる。AIが繰り返し作業をクリーンアップする。最終的な決定はあなたが行う。

## ソーシャルメディア向けの再フレーミング

プラットフォームによって異なるアスペクト比が必要：

| プラットフォーム | アスペクト比 | 解像度 |
|----------|-------------|------------|
| YouTube | 16:9 | 1920x1080 |
| TikTok / Reels | 9:16 | 1080x1920 |
| Instagram Feed | 1:1 | 1080x1080 |
| X / Twitter | 16:9 または 1:1 | 1280x720 または 720x720 |

### FFmpegで再フレーミングする

```bash
# 16:9 to 9:16 (center crop)
ffmpeg -i input.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" vertical.mp4

# 16:9 to 1:1 (center crop)
ffmpeg -i input.mp4 -vf "crop=ih:ih,scale=1080:1080" square.mp4
```

### VideoDBで再フレーミングする

```python
from videodb import ReframeMode

# Smart reframe (AI-guided subject tracking)
reframed = video.reframe(start=0, end=60, target="vertical", mode=ReframeMode.smart)
```

## シーン検出と自動カット

### FFmpegシーン検出

```bash
# Detect scene changes (threshold 0.3 = moderate sensitivity)
ffmpeg -i input.mp4 -vf "select='gt(scene,0.3)',showinfo" -vsync vfr -f null - 2>&1 | grep showinfo
```

### 自動カットのための無音検出

```bash
# Find silent segments (useful for cutting dead air)
ffmpeg -i input.mp4 -af silencedetect=noise=-30dB:d=2 -f null - 2>&1 | grep silence
```

### ハイライト抽出

Claudeを使用してトランスクリプト+シーンタイムスタンプを分析する：

```
「タイムスタンプ付きのトランスクリプトとシーントランジションポイントに基づいて、
ソーシャルメディア投稿に最適な5つの30秒の最も魅力的なクリップを見つけてください。」
```

## 各ツールが最も得意とすること

| ツール | 強み | 弱み |
|------|----------|----------|
| Claude / Codex | 整理、計画、コード生成 | クリエイティブな判断レイヤーではない |
| FFmpeg | 決定論的カット、バッチ処理、フォーマット変換 | ビジュアル編集UIなし |
| Remotion | プログラマブルオーバーレイ、コンポーザブルシーン、再利用可能テンプレート | 非開発者には学習曲線がある |
| Screen Studio | 即座に洗練されたスクリーンレコーディングを取得 | スクリーンキャプチャのみ |
| ElevenLabs | ボイス、ナレーション、音楽、効果音 | ワークフローのコアではない |
| Descript / CapCut | 最終ペーシング調整、字幕、仕上げ | 手動操作、自動化不可 |

## 主要原則

1. **生成ではなく編集。** このワークフローは実際の素材をカットするためのものであり、プロンプトから作成するものではない。
2. **スタイルより先に構造。** ビジュアル要素に触れる前に、レイヤー2でストーリー構造を確定させる。
3. **FFmpegが骨格。** 退屈だが重要。長い素材がここで管理可能になる。
4. **Remotionは再現性のために。** 何度も行う操作はRemotionコンポーネントにする。
5. **選択的な生成。** 存在しないアセットにのみAI生成を使用し、すべてには使用しない。
6. **センスは最後のレイヤー。** AIが繰り返し作業をクリーンアップする。最終的なクリエイティブな決定はあなたが行う。

## 関連スキル

* `fal-ai-media` — AI画像、ビデオ、オーディオ生成
* `videodb` — サーバーサイドのビデオ処理、インデックス作成、ストリーミング
* `content-engine` — プラットフォームネイティブなコンテンツ配信
