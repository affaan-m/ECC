# 生成式媒体指南

VideoDB 提供 AI 驱动的图像、视频、音乐、音效、语音和文本内容生成。所有生成方法均在 **Collection** 对象上。

## 先决条件

在调用任何生成方法之前，您需要一个连接和一个集合引用：

```python
import videodb

conn = videodb.connect()
coll = conn.get_collection()
```

## 图像生成

根据文本提示生成图像：

```python
image = coll.generate_image(
    prompt="a futuristic cityscape at sunset with flying cars",
    aspect_ratio="16:9",
)

# Access the generated image
print(image.id)
print(image.generate_url())  # returns a signed download URL
```

### generate\_image 参数

| 参数 | 类型 | 默认值 | 描述 |
|-----------|------|---------|-------------|
| `prompt` | `str` | 必需 | 要生成的图像的文本描述 |
| `aspect_ratio` | `str` | `"1:1"` | 宽高比：`"1:1"`, `"9:16"`, `"16:9"`, `"4:3"`, 或 `"3:4"` |
| `callback_url` | `str\|None` | `None` | 接收异步回调的 URL |

返回一个 `Image` 对象，包含 `.id`、`.name` 和 `.collection_id`。`.url` 属性对于生成的图像可能为 `None` —— 始终使用 `image.generate_url()` 来获取可靠的签名下载 URL。

> **注意：** 与 `Video` 对象（使用 `.generate_stream()`）不同，`Image` 对象使用 `.generate_url()` 来检索图像 URL。`.url` 属性仅针对某些图像类型（例如缩略图）填充。

## 视频生成

根据文本提示生成短视频片段：

```python
video = coll.generate_video(
    prompt="a timelapse of a flower blooming in a garden",
    duration=5,
)

stream_url = video.generate_stream()
video.play()
```

### generate\_video 参数

| 参数 | 类型 | 默认值 | 描述 |
|-----------|------|---------|-------------|
| `prompt` | `str` | 必需 | 要生成的视频的文本描述 |
| `duration` | `int` | `5` | 持续时间（秒）（必须是整数值，5-8） |
| `callback_url` | `str\|None` | `None` | 接收异步回调的 URL |

返回一个 `Video` 对象。生成的视频会自动添加到集合中，并且可以像任何上传的视频一样在时间线、搜索和编译中使用。

## 音频生成

VideoDB 为不同的音频类型提供了三种独立的方法。

### 音乐

根据文本描述生成背景音乐：

```python
music = coll.generate_music(
    prompt="upbeat electronic music with a driving beat, suitable for a tech demo",
    duration=30,
)

print(music.id)
```

| 参数 | 类型 | 默认值 | 描述 |
|-----------|------|---------|-------------|
| `prompt` | `str` | 必需 | 音乐的文本描述 |
| `duration` | `int` | `5` | 持续时间（秒） |
| `callback_url` | `str\|None` | `None` | 接收异步回调的 URL |

### 音效

生成特定的音效：

```python
sfx = coll.generate_sound_effect(
    prompt="thunderstorm with heavy rain and distant thunder",
    duration=10,
)
```

| 参数 | 类型 | 默认值 | 描述 |
|-----------|------|---------|-------------|
| `prompt` | `str` | 必需 | 音效的文本描述 |
| `duration` | `int` | `2` | 持续时间（秒） |
| `config` | `dict` | `{}` | 附加配置 |
| `callback_url` | `str\|None` | `None` | 接收异步回调的 URL |

### 语音（文本转语音）

从文本生成语音：

```python
voice = coll.generate_voice(
    text="Welcome to our product demo. Today we'll walk through the key features.",
    voice_name="Default",
)
```

| 参数 | 类型 | 默认值 | 描述 |
|-----------|------|---------|-------------|
| `text` | `str` | 必需 | 要转换为语音的文本 |
| `voice_name` | `str` | `"Default"` | 要使用的声音 |
| `config` | `dict` | `{}` | 附加配置 |
| `callback_url` | `str\|None` | `None` | 接收异步回调的 URL |

所有三种音频方法都返回一个 `Audio` 对象，包含 `.id`、`.name`、`.length` 和 `.collection_id`。

## 文本生成（LLM 集成）

使用 `coll.generate_text()` 来运行 LLM 分析。这是一个 **集合级** 方法 —— 直接在提示字符串中传递任何上下文（转录、描述）。

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

### generate\_text 参数

| 参数 | 类型 | 默认值 | 描述 |
|-----------|------|---------|-------------|
| `prompt` | `str` | 必需 | 包含 LLM 上下文的提示 |
| `model_name` | `str` | `"basic"` | 模型层级：`"basic"`、`"pro"` 或 `"ultra"` |
| `response_type` | `str` | `"text"` | 响应格式：`"text"` 或 `"json"` |

返回一个 `dict`，带有一个 `output` 键。当 `response_type="text"` 时，`output` 是一个 `str`。当 `response_type="json"` 时，`output` 是一个 `dict`。

```python
result = coll.generate_text(prompt="Summarize this", model_name="pro")
print(result["output"])  # access the actual text/dict
```

### 使用 LLM 分析场景

将场景提取与文本生成相结合：

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

## 配音和翻译

### 为视频配音

使用集合方法将视频配音为另一种语言：

```python
dubbed_video = coll.dub_video(
    video_id=video.id,
    language_code="es",  # Spanish
)

dubbed_video.play()
```

### dub\_video 参数

| 参数 | 类型 | 默认值 | 描述 |
|-----------|------|---------|-------------|
| `video_id` | `str` | 必需 | 要配音的视频 ID |
| `language_code` | `str` | 必需 | 目标语言代码（例如，`"es"`、`"fr"`、`"de"`） |
| `callback_url` | `str\|None` | `None` | 接收异步回调的 URL |

返回一个 `Video` 对象，其中包含配音内容。

### 翻译转录

翻译视频的转录文本，无需配音：

```python
translated = video.translate_transcript(
    language="Spanish",
    additional_notes="Use formal tone",
)

for entry in translated:
    print(entry)
```

**支持的语言** 包括：`en`、`es`、`fr`、`de`、`it`、`pt`、`ja`、`ko`、`zh`、`hi`、`ar` 等。

## 完整工作流示例

### 为视频生成旁白

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

### 根据提示生成缩略图

```python
thumbnail = coll.generate_image(
    prompt="professional video thumbnail showing data analytics dashboard, modern design",
    aspect_ratio="16:9",
)
print(f"Thumbnail URL: {thumbnail.generate_url()}")
```

### 为视频添加生成的音乐

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

### 结构化 JSON 输出

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

## 提示

* **生成的媒体是持久性的**：所有生成的内容都存储在您的集合中，并且可以重复使用。
* **三种音频方法**：使用 `generate_music()` 生成背景音乐，`generate_sound_effect()` 生成音效，`generate_voice()` 进行文本转语音。没有统一的 `generate_audio()` 方法。
* **文本生成是集合级的**：`coll.generate_text()` 不会自动访问视频内容。使用 `video.get_transcript_text()` 获取转录文本，并将其传递到提示中。
* **模型层级**：`"basic"` 速度最快，`"pro"` 是平衡选项，`"ultra"` 质量最高。对于大多数分析任务，使用 `"pro"`。
* **组合生成类型**：生成图像用于叠加、生成音乐用于背景、生成语音用于旁白，然后使用时间线进行组合（参见 [editor.md](editor.md)）。
* **提示质量很重要**：描述性、具体的提示在所有生成类型中都能产生更好的结果。
* **图像的宽高比**：从 `"1:1"`、`"9:16"`、`"16:9"`、`"4:3"` 或 `"3:4"` 中选择。
