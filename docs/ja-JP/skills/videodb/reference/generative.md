# 生成メディアガイド

VideoDBはAI駆動の画像、ビデオ、音楽、効果音、音声、テキストコンテンツ生成を提供する。すべての生成メソッドは**Collection**オブジェクト上にある。

## 前提条件

生成メソッドを呼び出す前に、接続とコレクションの参照が必要：

```python
import videodb

conn = videodb.connect()
coll = conn.get_collection()
```

## 画像生成

テキストプロンプトから画像を生成する：

```python
image = coll.generate_image(
    prompt="a futuristic cityscape at sunset with flying cars",
    aspect_ratio="16:9",
)

# Access the generated image
print(image.id)
print(image.generate_url())  # returns a signed download URL
```

### generate\_imageのパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `prompt` | `str` | 必須 | 生成する画像のテキスト説明 |
| `aspect_ratio` | `str` | `"1:1"` | アスペクト比：`"1:1"`, `"9:16"`, `"16:9"`, `"4:3"`, または `"3:4"` |
| `callback_url` | `str\|None` | `None` | 非同期コールバックを受信するURL |

`.id`、`.name`、`.collection_id` を含む `Image` オブジェクトを返す。生成された画像の `.url` 属性は `None` になる可能性がある——信頼できる署名付きダウンロードURLを取得するには常に `image.generate_url()` を使用すること。

> **注意：** `Video` オブジェクト（`.generate_stream()` を使用）と異なり、`Image` オブジェクトは画像URLを取得するために `.generate_url()` を使用する。`.url` 属性は特定の画像タイプ（例：サムネイル）に対してのみ設定される。

## ビデオ生成

テキストプロンプトから短いビデオクリップを生成する：

```python
video = coll.generate_video(
    prompt="a timelapse of a flower blooming in a garden",
    duration=5,
)

stream_url = video.generate_stream()
video.play()
```

### generate\_videoのパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `prompt` | `str` | 必須 | 生成するビデオのテキスト説明 |
| `duration` | `int` | `5` | 長さ（秒）（整数値、5〜8でなければならない） |
| `callback_url` | `str\|None` | `None` | 非同期コールバックを受信するURL |

`Video` オブジェクトを返す。生成されたビデオは自動的にコレクションに追加され、アップロードされたビデオと同様にタイムライン、検索、コンパイルで使用できる。

## オーディオ生成

VideoDBは異なるオーディオタイプのために3つの独立したメソッドを提供する。

### 音楽

テキスト説明からバックグラウンドミュージックを生成する：

```python
music = coll.generate_music(
    prompt="upbeat electronic music with a driving beat, suitable for a tech demo",
    duration=30,
)

print(music.id)
```

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `prompt` | `str` | 必須 | 音楽のテキスト説明 |
| `duration` | `int` | `5` | 長さ（秒） |
| `callback_url` | `str\|None` | `None` | 非同期コールバックを受信するURL |

### 効果音

特定の効果音を生成する：

```python
sfx = coll.generate_sound_effect(
    prompt="thunderstorm with heavy rain and distant thunder",
    duration=10,
)
```

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `prompt` | `str` | 必須 | 効果音のテキスト説明 |
| `duration` | `int` | `2` | 長さ（秒） |
| `config` | `dict` | `{}` | 追加設定 |
| `callback_url` | `str\|None` | `None` | 非同期コールバックを受信するURL |

### 音声（テキスト読み上げ）

テキストから音声を生成する：

```python
voice = coll.generate_voice(
    text="Welcome to our product demo. Today we'll walk through the key features.",
    voice_name="Default",
)
```

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `text` | `str` | 必須 | 音声に変換するテキスト |
| `voice_name` | `str` | `"Default"` | 使用する音声 |
| `config` | `dict` | `{}` | 追加設定 |
| `callback_url` | `str\|None` | `None` | 非同期コールバックを受信するURL |

3つのオーディオメソッドはすべて `.id`、`.name`、`.length`、`.collection_id` を含む `Audio` オブジェクトを返す。

## テキスト生成（LLM統合）

`coll.generate_text()` を使用してLLM分析を実行する。これは**コレクションレベル**のメソッド——プロンプト文字列に任意のコンテキスト（トランスクリプト、説明）を直接渡す。

```python
# Get transcript from a video first
transcript_text = video.get_transcript_text()

# Generate analysis using collection LLM
result = coll.generate_text(
    prompt=f"Summarize the key points discussed in this video:\n{transcript_text}",
    model_name="pro",
)

print(result["output"])
```

### generate\_textのパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `prompt` | `str` | 必須 | LLMコンテキストを含むプロンプト |
| `model_name` | `str` | `"basic"` | モデル層：`"basic"`、`"pro"`、または `"ultra"` |
| `response_type` | `str` | `"text"` | レスポンスフォーマット：`"text"` または `"json"` |

`output` キーを持つ `dict` を返す。`response_type="text"` の場合、`output` は `str`。`response_type="json"` の場合、`output` は `dict`。

```python
result = coll.generate_text(prompt="Summarize this", model_name="pro")
print(result["output"])  # access the actual text/dict
```

### LLMを使用したシーン分析

シーン抽出とテキスト生成を組み合わせる：

```python
from videodb import SceneExtractionType

# First index scenes
scenes = video.index_scenes(
    extraction_type=SceneExtractionType.time_based,
    extraction_config={"time": 10},
    prompt="Describe the visual content in this scene.",
)

# Get transcript for spoken context
transcript_text = video.get_transcript_text()
scene_descriptions = []
for scene in scenes:
    if isinstance(scene, dict):
        description = scene.get("description") or scene.get("summary")
    else:
        description = getattr(scene, "description", None) or getattr(scene, "summary", None)
    scene_descriptions.append(description or str(scene))

scenes_text = "\n".join(scene_descriptions)

# Analyze with collection LLM
result = coll.generate_text(
    prompt=(
        f"Given this video transcript:\n{transcript_text}\n\n"
        f"And these visual scene descriptions:\n{scenes_text}\n\n"
        "Based on the spoken and visual content, describe the main topics covered."
    ),
    model_name="pro",
)
print(result["output"])
```

## 吹き替えと翻訳

### ビデオの吹き替え

コレクションメソッドを使用してビデオを別の言語に吹き替える：

```python
dubbed_video = coll.dub_video(
    video_id=video.id,
    language_code="es",  # Spanish
)

dubbed_video.play()
```

### dub\_videoのパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `video_id` | `str` | 必須 | 吹き替えるビデオのID |
| `language_code` | `str` | 必須 | ターゲット言語コード（例：`"es"`、`"fr"`、`"de"`） |
| `callback_url` | `str\|None` | `None` | 非同期コールバックを受信するURL |

吹き替えられたコンテンツを含む `Video` オブジェクトを返す。

### トランスクリプトの翻訳

吹き替えなしでビデオのトランスクリプトを翻訳する：

```python
translated = video.translate_transcript(
    language="Spanish",
    additional_notes="Use formal tone",
)

for entry in translated:
    print(entry)
```

**サポートされる言語**：`en`、`es`、`fr`、`de`、`it`、`pt`、`ja`、`ko`、`zh`、`hi`、`ar` など。

## 完全なワークフロー例

### ビデオのナレーション生成

```python
import videodb

conn = videodb.connect()
coll = conn.get_collection()
video = coll.get_video("your-video-id")

# Get transcript
transcript_text = video.get_transcript_text()

# Generate narration script using collection LLM
result = coll.generate_text(
    prompt=(
        f"Write a professional narration script for this video content:\n"
        f"{transcript_text[:2000]}"
    ),
    model_name="pro",
)
script = result["output"]

# Convert script to speech
narration = coll.generate_voice(text=script)
print(f"Narration audio: {narration.id}")
```

### プロンプトからサムネイルを生成する

```python
thumbnail = coll.generate_image(
    prompt="professional video thumbnail showing data analytics dashboard, modern design",
    aspect_ratio="16:9",
)
print(f"Thumbnail URL: {thumbnail.generate_url()}")
```

### ビデオに生成された音楽を追加する

```python
import videodb
from videodb.timeline import Timeline
from videodb.asset import VideoAsset, AudioAsset

conn = videodb.connect()
coll = conn.get_collection()
video = coll.get_video("your-video-id")

# Generate background music
music = coll.generate_music(
    prompt="calm ambient background music for a tutorial video",
    duration=60,
)

# Build timeline with video + music overlay
timeline = Timeline(conn)
timeline.add_inline(VideoAsset(asset_id=video.id))
timeline.add_overlay(0, AudioAsset(asset_id=music.id, disable_other_tracks=False))

stream_url = timeline.generate_stream()
print(f"Video with music: {stream_url}")
```

### 構造化JSON出力

```python
transcript_text = video.get_transcript_text()

result = coll.generate_text(
    prompt=(
        f"Given this transcript:\n{transcript_text}\n\n"
        "Return a JSON object with keys: summary, topics (array), action_items (array)."
    ),
    model_name="pro",
    response_type="json",
)

# result["output"] is a dict when response_type="json"
print(result["output"]["summary"])
print(result["output"]["topics"])
```

## ヒント

* **生成されたメディアは永続的**：すべての生成されたコンテンツはコレクションに保存され、再利用できる。
* **3つのオーディオメソッド**：バックグラウンドミュージックには `generate_music()`、効果音には `generate_sound_effect()`、テキスト読み上げには `generate_voice()` を使用する。統一された `generate_audio()` メソッドはない。
* **テキスト生成はコレクションレベル**：`coll.generate_text()` はビデオコンテンツに自動的にアクセスしない。`video.get_transcript_text()` でトランスクリプトを取得し、プロンプトに渡す。
* **モデル層**：`"basic"` が最速、`"pro"` がバランスの取れたオプション、`"ultra"` が最高品質。ほとんどの分析タスクには `"pro"` を使用する。
* **生成タイプを組み合わせる**：オーバーレイ用に画像を生成し、バックグラウンド用に音楽を生成し、ナレーション用に音声を生成し、タイムラインを使用してそれらを組み合わせる（[editor.md](editor.md) を参照）。
* **プロンプトの品質が重要**：説明的で具体的なプロンプトはすべての生成タイプでより良い結果を生む。
* **画像のアスペクト比**：`"1:1"`、`"9:16"`、`"16:9"`、`"4:3"`、または `"3:4"` から選択する。
