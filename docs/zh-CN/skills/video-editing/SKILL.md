---
name: video-editing
description: AI辅助的视频编辑工作流程，用于剪辑、构建和增强实拍素材。涵盖从原始拍摄到FFmpeg、Remotion、ElevenLabs、fal.ai，再到Descript或CapCut最终润色的完整流程。适用于用户想要编辑视频、剪辑素材、制作vlog或构建视频内容的情况。
origin: ECC
---

# 视频编辑

针对真实素材的AI辅助编辑。非根据提示生成。快速编辑现有视频。

## 何时激活

* 用户想要编辑、剪辑或构建视频素材
* 将长录制内容转化为短视频内容
* 从原始素材构建vlog、教程或演示视频
* 为现有视频添加叠加层、字幕、音乐或画外音
* 为不同平台（YouTube、TikTok、Instagram）重新构图视频
* 用户提到“编辑视频”、“剪辑这个素材”、“制作vlog”或“视频工作流”

## 核心理念

当你不再要求AI创建整个视频，而是开始使用它来压缩、构建和增强真实素材时，AI视频编辑就变得有用了。价值不在于生成。价值在于压缩。

## 处理流程

```
Screen Studio / 原始素材
  → Claude / Codex
  → FFmpeg
  → Remotion
  → ElevenLabs / fal.ai
  → Descript 或 CapCut
```

每个层级都有特定的工作。不要跳过层级。不要试图让一个工具完成所有事情。

## 层级 1：采集（Screen Studio / 原始素材）

收集源材料：

* **Screen Studio**：用于应用演示、编码会话、浏览器工作流程的精致屏幕录制
* **原始摄像机素材**：vlog素材、采访、活动录制
* **通过VideoDB的桌面采集**：具有实时上下文的会话录制（参见 `videodb` 技能）

输出：准备进行组织的原始文件。

## 层级 2：组织（Claude / Codex）

使用Claude Code或Codex进行：

* **转录和标记**：生成转录稿，识别主题和要点
* **规划结构**：决定保留内容、剪切内容、确定顺序
* **识别无效片段**：查找停顿、离题、重复拍摄
* **生成编辑决策列表**：用于剪辑的时间戳、保留的片段
* **搭建FFmpeg和Remotion代码**：生成命令和合成

```
示例提示词：
"这是一份4小时录音的文字记录。找出最适合制作24分钟vlog的8个精彩片段。
为每个片段提供FFmpeg剪辑命令。"
```

此层级关乎结构，而非最终的创意品味。

## 层级 3：确定性剪辑（FFmpeg）

FFmpeg处理枯燥但关键的工作：分割、修剪、连接和预处理。

### 按时间戳提取片段

```bash
ffmpeg -i raw.mp4 -ss 00:12:30 -to 00:15:45 -c copy segment_01.mp4
```

### 根据编辑决策列表批量剪辑

```bash
#!/bin/bash
# cuts.txt: start,end,label
while IFS=, read -r start end label; do
  ffmpeg -i raw.mp4 -ss "$start" -to "$end" -c copy "segments/${label}.mp4"
done < cuts.txt
```

### 连接片段

```bash
# Create file list
for f in segments/*.mp4; do echo "file '$f'"; done > concat.txt
ffmpeg -f concat -safe 0 -i concat.txt -c copy assembled.mp4
```

### 创建代理文件以加速编辑

```bash
ffmpeg -i raw.mp4 -vf "scale=960:-2" -c:v libx264 -preset ultrafast -crf 28 proxy.mp4
```

### 提取音频用于转录

```bash
ffmpeg -i raw.mp4 -vn -acodec pcm_s16le -ar 16000 audio.wav
```

### 标准化音频电平

```bash
ffmpeg -i segment.mp4 -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:v copy normalized.mp4
```

## 层级 4：可编程合成（Remotion）

Remotion将编辑问题转化为可组合的代码。用它来处理传统编辑器让工作变得痛苦的事情：

### 何时使用Remotion

* 叠加层：文本、图像、品牌标识、下三分之一字幕
* 数据可视化：图表、统计数据、动画数字
* 动态图形：转场、解说动画
* 可组合场景：跨视频可重复使用的模板
* 产品演示：带注释的截图、UI高亮

### 基本的Remotion合成

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

### 渲染输出

```bash
npx remotion render src/index.ts VlogComposition output.mp4
```

有关详细模式和API参考，请参阅[Remotion文档](https://www.remotion.dev/docs)。

## 层级 5：生成资产（ElevenLabs / fal.ai）

仅生成所需内容。不要生成整个视频。

### 使用ElevenLabs进行画外音

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

### 使用fal.ai生成音乐和音效

使用 `fal-ai-media` 技能进行：

* 背景音乐生成
* 音效（用于视频转音频的ThinkSound模型）
* 转场音效

### 使用fal.ai生成视觉效果

用于不存在的插入镜头、缩略图或B-roll素材：

```
generate(app_id: "fal-ai/nano-banana-pro", input_data: {
  "prompt": "专业科技视频缩略图，深色背景，屏幕上显示代码",
  "image_size": "landscape_16_9"
})
```

### VideoDB生成式音频

如果配置了VideoDB：

```python
voiceover = coll.generate_voice(text="Narration here", voice="alloy")
music = coll.generate_music(prompt="lo-fi background for coding vlog", duration=120)
sfx = coll.generate_sound_effect(prompt="subtle whoosh transition")
```

## 层级 6：最终润色（Descript / CapCut）

最后一层由人工完成。使用传统编辑器进行：

* **节奏调整**：调整感觉太快或太慢的剪辑
* **字幕**：自动生成，然后手动清理
* **色彩分级**：基本校正和氛围调整
* **最终音频混音**：平衡人声、音乐和音效的电平
* **导出**：平台特定的格式和质量设置

品味体现在此。AI清理重复性工作。你做出最终决定。

## 社交媒体重新构图

不同平台需要不同的宽高比：

| 平台 | 宽高比 | 分辨率 |
|----------|-------------|------------|
| YouTube | 16:9 | 1920x1080 |
| TikTok / Reels | 9:16 | 1080x1920 |
| Instagram Feed | 1:1 | 1080x1080 |
| X / Twitter | 16:9 或 1:1 | 1280x720 或 720x720 |

### 使用FFmpeg重新构图

```bash
# 16:9 to 9:16 (center crop)
ffmpeg -i input.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" vertical.mp4

# 16:9 to 1:1 (center crop)
ffmpeg -i input.mp4 -vf "crop=ih:ih,scale=1080:1080" square.mp4
```

### 使用VideoDB重新构图

```python
from videodb import ReframeMode

# Smart reframe (AI-guided subject tracking)
reframed = video.reframe(start=0, end=60, target="vertical", mode=ReframeMode.smart)
```

## 场景检测与自动剪辑

### FFmpeg场景检测

```bash
# Detect scene changes (threshold 0.3 = moderate sensitivity)
ffmpeg -i input.mp4 -vf "select='gt(scene,0.3)',showinfo" -vsync vfr -f null - 2>&1 | grep showinfo
```

### 用于自动剪辑的静音检测

```bash
# Find silent segments (useful for cutting dead air)
ffmpeg -i input.mp4 -af silencedetect=noise=-30dB:d=2 -f null - 2>&1 | grep silence
```

### 精彩片段提取

使用Claude分析转录稿 + 场景时间戳：

```
"根据这份带时间戳的转录稿和这些场景转换点，找出最适合社交媒体发布的5段30秒最吸引人的剪辑片段。"
```

## 每个工具最擅长什么

| 工具 | 优势 | 劣势 |
|------|----------|----------|
| Claude / Codex | 组织、规划、代码生成 | 不是创意品味层 |
| FFmpeg | 确定性剪辑、批量处理、格式转换 | 无可视化编辑UI |
| Remotion | 可编程叠加层、可组合场景、可重复使用模板 | 对非开发者有学习曲线 |
| Screen Studio | 即时获得精致的屏幕录制 | 仅限屏幕采集 |
| ElevenLabs | 人声、旁白、音乐、音效 | 不是工作流程的核心 |
| Descript / CapCut | 最终节奏调整、字幕、润色 | 手动操作，不可自动化 |

## 关键原则

1. **编辑，而非生成。** 此工作流程用于剪辑真实素材，而非根据提示创建。
2. **先结构，后风格。** 在接触任何视觉元素之前，先在层级2确定好故事结构。
3. **FFmpeg是支柱。** 枯燥但关键。长素材在此变得易于管理。
4. **Remotion用于可重复性。** 如果你会多次执行某项操作，就将其制作成Remotion组件。
5. **选择性生成。** 仅对不存在的资产使用AI生成，而非所有内容。
6. **品味是最后一层。** AI清理重复性工作。你做出最终的创意决定。

## 相关技能

* `fal-ai-media` — AI图像、视频和音频生成
* `videodb` — 服务器端视频处理、索引和流媒体
* `content-engine` — 平台原生内容分发
