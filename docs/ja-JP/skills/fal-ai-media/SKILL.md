---
name: fal-ai-media
description: fal.ai MCPによる統合メディア生成（画像、動画、音声）。テキストから画像（Nano Banana）、テキスト/画像から動画（Seedance、Kling、Veo 3）、テキストから音声（CSM-1B）、動画から音声（ThinkSound）をカバーします。ユーザーがAIで画像、動画、音声を生成したい場合に使用します。
origin: ECC
---

# fal.aiメディア生成

> **変化が早いスキル。** fal.aiのモデルID、価格、入力、MCPツール名は急速に変わります。特定のモデル、パラメーター、出力形式、またはコストを約束する前に、現在のモデルメタデータを検索または取得してください。

MCPを通じてfal.aiモデルを使用して画像、動画、音声を生成します。

## アクティベートするタイミング

- ユーザーがテキストプロンプトから画像を生成したい場合
- テキストまたは画像から動画を作成する場合
- 音声、音楽、または効果音を生成する場合
- あらゆるメディア生成タスク
- ユーザーが「generate image」「create video」「text to speech」「make a thumbnail」などと言う場合

## MCP要件

fal.ai MCPサーバーを設定する必要があります。`~/.claude.json`に追加してください:

```json
"fal-ai": {
  "command": "npx",
  "args": ["-y", "fal-ai-mcp-server"],
  "env": { "FAL_KEY": "YOUR_FAL_KEY_HERE" }
}
```

APIキーは[fal.ai](https://fal.ai)で取得してください。

## MCPツール

fal.ai MCPは以下のツールを提供します:
- `search` — キーワードで利用可能なモデルを検索
- `find` — モデルの詳細とパラメーターを取得
- `generate` — パラメーターでモデルを実行
- `result` — 非同期生成のステータスを確認
- `status` — ジョブステータスを確認
- `cancel` — 実行中のジョブをキャンセル
- `estimate_cost` — 生成コストを見積もる
- `models` — 人気モデルの一覧表示
- `upload` — 入力として使用するファイルをアップロード

---

## 画像生成

### Nano Banana 2（高速）
ベストユースケース: クイックイテレーション、ドラフト、テキストから画像、画像編集。

```
generate(
  app_id: "fal-ai/nano-banana-2",
  input_data: {
    "prompt": "a futuristic cityscape at sunset, cyberpunk style",
    "image_size": "landscape_16_9",
    "num_images": 1,
    "seed": 42
  }
)
```

### Nano Banana Pro（高忠実度）
ベストユースケース: 本番画像、リアリズム、タイポグラフィ、詳細なプロンプト。

```
generate(
  app_id: "fal-ai/nano-banana-pro",
  input_data: {
    "prompt": "professional product photo of wireless headphones on marble surface, studio lighting",
    "image_size": "square",
    "num_images": 1,
    "guidance_scale": 7.5
  }
)
```

### 一般的な画像パラメーター

| パラメーター | 型 | オプション | 備考 |
|-------|------|---------|-------|
| `prompt` | string | 必須 | 生成したいものを説明する |
| `image_size` | string | `square`、`portrait_4_3`、`landscape_16_9`、`portrait_16_9`、`landscape_4_3` | アスペクト比 |
| `num_images` | number | 1-4 | 生成する数 |
| `seed` | number | 任意の整数 | 再現性 |
| `guidance_scale` | number | 1-20 | プロンプトへの追従度（高いほど文字通り） |

### 画像編集
インペインティング、アウトペインティング、またはスタイル転送にNano Banana 2を入力画像と共に使用:

```
# まずソース画像をアップロード
upload(file_path: "/path/to/image.png")

# 次に画像入力で生成
generate(
  app_id: "fal-ai/nano-banana-2",
  input_data: {
    "prompt": "same scene but in watercolor style",
    "image_url": "<uploaded_url>",
    "image_size": "landscape_16_9"
  }
)
```

---

## 動画生成

### Seedance 1.0 Pro（ByteDance）
ベストユースケース: テキストから動画、高モーション品質の画像から動画。

```
generate(
  app_id: "fal-ai/seedance-1-0-pro",
  input_data: {
    "prompt": "a drone flyover of a mountain lake at golden hour, cinematic",
    "duration": "5s",
    "aspect_ratio": "16:9",
    "seed": 42
  }
)
```

### Kling Video v3 Pro
ベストユースケース: ネイティブ音声生成付きのテキスト/画像から動画。

```
generate(
  app_id: "fal-ai/kling-video/v3/pro",
  input_data: {
    "prompt": "ocean waves crashing on a rocky coast, dramatic clouds",
    "duration": "5s",
    "aspect_ratio": "16:9"
  }
)
```

### Veo 3（Google DeepMind）
ベストユースケース: 生成された音声付き、高視覚品質の動画。

```
generate(
  app_id: "fal-ai/veo-3",
  input_data: {
    "prompt": "a bustling Tokyo street market at night, neon signs, crowd noise",
    "aspect_ratio": "16:9"
  }
)
```

### 画像から動画
既存の画像から開始:

```
generate(
  app_id: "fal-ai/seedance-1-0-pro",
  input_data: {
    "prompt": "camera slowly zooms out, gentle wind moves the trees",
    "image_url": "<uploaded_image_url>",
    "duration": "5s"
  }
)
```

### 動画パラメーター

| パラメーター | 型 | オプション | 備考 |
|-------|------|---------|-------|
| `prompt` | string | 必須 | 動画を説明する |
| `duration` | string | `"5s"`、`"10s"` | 動画の長さ |
| `aspect_ratio` | string | `"16:9"`、`"9:16"`、`"1:1"` | フレーム比率 |
| `seed` | number | 任意の整数 | 再現性 |
| `image_url` | string | URL | 画像から動画用のソース画像 |

---

## 音声生成

### CSM-1B（会話的スピーチ）
自然な会話品質のテキストから音声。

```
generate(
  app_id: "fal-ai/csm-1b",
  input_data: {
    "text": "Hello, welcome to the demo. Let me show you how this works.",
    "speaker_id": 0
  }
)
```

### ThinkSound（動画から音声）
動画コンテンツからマッチする音声を生成。

```
generate(
  app_id: "fal-ai/thinksound",
  input_data: {
    "video_url": "<video_url>",
    "prompt": "ambient forest sounds with birds chirping"
  }
)
```

### ElevenLabs（API経由、MCPなし）
プロフェッショナルな音声合成には、ElevenLabsを直接使用:

```python
import os
import requests

resp = requests.post(
    "https://api.elevenlabs.io/v1/text-to-speech/<voice_id>",
    headers={
        "xi-api-key": os.environ["ELEVENLABS_API_KEY"],
        "Content-Type": "application/json"
    },
    json={
        "text": "Your text here",
        "model_id": "eleven_turbo_v2_5",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}
    }
)
with open("output.mp3", "wb") as f:
    f.write(resp.content)
```

### VideoDB生成音声
VideoDBが設定されている場合、その生成音声を使用:

```python
# 音声生成
audio = coll.generate_voice(text="Your narration here", voice="alloy")

# 音楽生成
music = coll.generate_music(prompt="upbeat electronic background music", duration=30)

# 効果音
sfx = coll.generate_sound_effect(prompt="thunder crack followed by rain")
```

---

## コスト見積もり

生成前に見積もりコストを確認:

```
estimate_cost(
  estimate_type: "unit_price",
  endpoints: {
    "fal-ai/nano-banana-pro": {
      "unit_quantity": 1
    }
  }
)
```

## モデル探索

特定のタスクに対するモデルを検索:

```
search(query: "text to video")
find(endpoint_ids: ["fal-ai/seedance-1-0-pro"])
models()
```

## ヒント

- プロンプトを繰り返す際の再現性のために`seed`を使用する
- プロンプトのイテレーションには低コストのモデル（Nano Banana 2）から始め、最終版ではProに切り替える
- 動画の場合、プロンプトはモーションとシーンに焦点を当てて説明的だが簡潔に
- 画像から動画は純粋なテキストから動画よりも制御された結果を生成する
- 高コストの動画生成を実行する前に`estimate_cost`を確認する

## 関連スキル

- `videodb` — 動画処理、編集、ストリーミング
- `video-editing` — AI駆動の動画編集ワークフロー
- `content-engine` — ソーシャルプラットフォーム向けコンテンツ作成
