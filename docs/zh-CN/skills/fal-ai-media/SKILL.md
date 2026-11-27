---
name: fal-ai-media
description: 通过 fal.ai MCP 实现统一的媒体生成——图像、视频和音频。涵盖文本到图像（Nano Banana）、文本/图像到视频（Seedance、Kling、Veo 3）、文本到语音（CSM-1B），以及视频到音频（ThinkSound）。当用户想要使用 AI 生成图像、视频或音频时使用。
origin: ECC
---

# fal.ai 媒体生成

通过 MCP 使用 fal.ai 模型生成图像、视频和音频。

## 何时激活

* 用户希望根据文本提示生成图像
* 根据文本或图像创建视频
* 生成语音、音乐或音效
* 任何媒体生成任务
* 用户提及“生成图像”、“创建视频”、“文本转语音”、“制作缩略图”或类似表述

## MCP 要求

必须配置 fal.ai MCP 服务器。添加到 `~/.claude.json`：

```json
"fal-ai": {
  "command": "npx",
  "args": ["-y", "fal-ai-mcp-server"],
  "env": { "FAL_KEY": "YOUR_FAL_KEY_HERE" }
}
```

在 [fal.ai](https://fal.ai) 获取 API 密钥。

## MCP 工具

fal.ai MCP 提供以下工具：

* `search` — 通过关键词查找可用模型
* `find` — 获取模型详情和参数
* `generate` — 使用参数运行模型
* `result` — 检查异步生成状态
* `status` — 检查作业状态
* `cancel` — 取消正在运行的作业
* `estimate_cost` — 估算生成成本
* `models` — 列出热门模型
* `upload` — 上传文件用作输入

***

## 图像生成

### Nano Banana 2（快速）

最适合：快速迭代、草稿、文生图、图像编辑。

```
generate(
  app_id: "fal-ai/nano-banana-2",
  input_data: {
    "prompt": "未来主义日落城市景观，赛博朋克风格",
    "image_size": "landscape_16_9",
    "num_images": 1,
    "seed": 42
  }
)
```

### Nano Banana Pro（高保真）

最适合：生产级图像、写实感、排版、详细提示。

```
generate(
  app_id: "fal-ai/nano-banana-pro",
  input_data: {
    "prompt": "专业产品照片，无线耳机置于大理石表面，影棚灯光",
    "image_size": "square",
    "num_images": 1,
    "guidance_scale": 7.5
  }
)
```

### 常见图像参数

| 参数 | 类型 | 选项 | 说明 |
|-------|------|---------|-------|
| `prompt` | 字符串 | 必需 | 描述您想要的内容 |
| `image_size` | 字符串 | `square`、`portrait_4_3`、`landscape_16_9`、`portrait_16_9`、`landscape_4_3` | 宽高比 |
| `num_images` | 数字 | 1-4 | 生成数量 |
| `seed` | 数字 | 任意整数 | 可重现性 |
| `guidance_scale` | 数字 | 1-20 | 遵循提示的紧密程度（值越高越贴近字面） |

### 图像编辑

使用 Nano Banana 2 并输入图像进行修复、扩展或风格迁移：

```
# 首先上传源图像
upload(file_path: "/path/to/image.png")

# 然后使用图像输入进行生成
generate(
  app_id: "fal-ai/nano-banana-2",
  input_data: {
    "prompt": "same scene but in watercolor style",
    "image_url": "<uploaded_url>",
    "image_size": "landscape_16_9"
  }
)
```

***

## 视频生成

### Seedance 1.0 Pro（字节跳动）

最适合：文生视频、图生视频，具有高运动质量。

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

最适合：文生/图生视频，带原生音频生成。

```
generate(
  app_id: "fal-ai/kling-video/v3/pro",
  input_data: {
    "prompt": "海浪拍打着岩石海岸，乌云密布",
    "duration": "5s",
    "aspect_ratio": "16:9"
  }
)
```

### Veo 3（Google DeepMind）

最适合：带生成声音的视频，高视觉质量。

```
generate(
  app_id: "fal-ai/veo-3",
  input_data: {
    "prompt": "夜晚熙熙攘攘的东京街头市场，霓虹灯招牌，人群喧嚣",
    "aspect_ratio": "16:9"
  }
)
```

### 图生视频

从现有图像开始：

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

### 视频参数

| 参数 | 类型 | 选项 | 说明 |
|-------|------|---------|-------|
| `prompt` | 字符串 | 必需 | 描述视频内容 |
| `duration` | 字符串 | `"5s"`、`"10s"` | 视频长度 |
| `aspect_ratio` | 字符串 | `"16:9"`、`"9:16"`、`"1:1"` | 帧比例 |
| `seed` | 数字 | 任意整数 | 可重现性 |
| `image_url` | 字符串 | URL | 用于图生视频的源图像 |

***

## 音频生成

### CSM-1B（对话语音）

文本转语音，具有自然、对话式的音质。

```
generate(
  app_id: "fal-ai/csm-1b",
  input_data: {
    "text": "Hello, welcome to the demo. Let me show you how this works.",
    "speaker_id": 0
  }
)
```

### ThinkSound（视频转音频）

根据视频内容生成匹配的音频。

```
generate(
  app_id: "fal-ai/thinksound",
  input_data: {
    "video_url": "<video_url>",
    "prompt": "ambient forest sounds with birds chirping"
  }
)
```

### ElevenLabs（通过 API，无 MCP）

如需专业的语音合成，直接使用 ElevenLabs：

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

### VideoDB 生成式音频

如果配置了 VideoDB，使用其生成式音频：

```python
# Voice generation
audio = coll.generate_voice(text="Your narration here", voice="alloy")

# Music generation
music = coll.generate_music(prompt="upbeat electronic background music", duration=30)

# Sound effects
sfx = coll.generate_sound_effect(prompt="thunder crack followed by rain")
```

***

## 成本估算

生成前，检查估算成本：

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

## 模型发现

查找特定任务的模型：

```
search(query: "text to video")
find(endpoint_ids: ["fal-ai/seedance-1-0-pro"])
models()
```

## 提示

* 在迭代提示时，使用 `seed` 以获得可重现的结果
* 先用低成本模型（Nano Banana 2）进行提示迭代，然后切换到 Pro 版进行最终生成
* 对于视频，保持提示描述性但简洁——聚焦于运动和场景
* 图生视频比纯文生视频能产生更可控的结果
* 在运行昂贵的视频生成前，检查 `estimate_cost`

## 相关技能

* `videodb` — 视频处理、编辑和流媒体
* `video-editing` — AI 驱动的视频编辑工作流
* `content-engine` — 社交媒体平台内容创作
