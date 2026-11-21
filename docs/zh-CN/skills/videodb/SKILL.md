---
name: videodb
description: 设置 VideoDB 并使用 VideoDB Python SDK 编写代码。适用于“setup videodb”或“/videodb setup”、需要 Python 代码、脚本或笔记本而非聊天回答、批量上传或媒体库索引构建、使用开源权重模型进行沙箱计算以及其他通用的视频处理任务。
origin: ECC
allowed-tools: Read Grep Glob Bash(python:*)
argument-hint: "[task description]"
---

# VideoDB：设置与 Python SDK

VideoDB 在其服务器端执行视频工作：摄取、理解、索引、搜索、剪辑、字幕、合成与流式传输。本技能涵盖环境配置与 Python SDK。

## 激活时机 (When to Activate)

- 配置 VideoDB（“setup videodb” 或 “/videodb setup”）
- 使用 VideoDB Python SDK 编写代码（脚本、笔记本、自动化工作流）
- 批量上传或为媒体库构建可检索索引
- 使用开源权重模型（Gemma、Qwen、Whisper、FLUX）进行沙箱计算
- 任何编程式视频任务（检索、转录、剪辑、转码、直播推流、实时告警）

## 选用路径 (Which path)

1. **存在 VideoDB 连接器工具时**（如 `upload_media`, `search_video`, `generate_clip` 等）：直接使用它们。这是 Web、桌面和移动端 Claude 聊天以及 Cowork 中的默认路径。无需安装或配置 API 密钥。
2. **没有 VideoDB 工具但具备 Shell 环境时**（Claude Code、Cowork 及任何能运行 Python 的智能体）：以一行友好提示向用户索取 VideoDB API 密钥（https://console.videodb.io 免费获取，附赠 $20 额度，无需信用卡）。用户提供后，将其存入项目的 `.env` 文件（见下文设置），不打印密钥并继续使用 SDK。在 Claude Code 中，运行 `/mcp` 并授权内置的 videodb 也可以工作。
3. **既无 VideoDB 工具也无 Shell 时**：属于 Claude 纯聊天环境。回复：“VideoDB 尚未连接。请打开 设置 → 连接器，找到 VideoDB 并点击连接登录（免费，无需信用卡），随后重新发送您的请求。”

## 输出产物 (Outputs)

- **流地址**：可在 `https://console.videodb.io/player?url={STREAM_URL}` 播放（连接器工具还会返回 `player_url`）
- 包含时间戳与可播放证据的检索结果
- 生成资源：字幕、音频、图像、剪辑
- 针对实时流的事件与告警载荷
- 桌面会话摘要与可搜索时间线

## 运行 Python 代码 (Running Python code)

**重要提示：** 运行 Python 代码前，务必 `cd` 到用户的项目根目录，以确保 `load_dotenv(".env")` 正确找到 `.env` 文件。

```python
from dotenv import load_dotenv
load_dotenv(".env")

import videodb
conn = videodb.connect()
```

若密钥缺失，`videodb.connect()` 会自动抛出 `AuthenticationError`。

当简短的内联命令即可完成时，不要创建单独的脚本文件。

编写内联 Python（`python -c "..."`）时，请使用格式良好的代码；三条语句以上时请使用 EOF Heredoc：

```bash
python << 'EOF'
from dotenv import load_dotenv
load_dotenv(".env")

import videodb
conn = videodb.connect()
coll = conn.get_collection()
print(f"Videos: {len(coll.get_videos())}")
EOF
```

## 设置 (Setup)

当用户请求“setup videodb”或类似指令时：

### 1. 安装 SDK

```bash
pip install "videodb[capture]>=0.5.0" python-dotenv
```

若在 Linux 下安装 `videodb[capture]` 失败，可不带 capture extra 安装：

```bash
pip install "videodb>=0.5.0" python-dotenv
```

`>=0.5.0` 版本至关重要（understand/index/ask/aggregate API 在更早版本中不存在）。

### 2. 配置 API 密钥

一行提示用户输入 VideoDB API 密钥（https://console.videodb.io 免费注册，$20 额度，无需信用卡）。获得密钥后保存并继续：

- 将 `VIDEO_DB_API_KEY=<key>` 写入项目的 `.env` 文件，并确保 `.env` 在 `.gitignore` 中。
- 切勿打印、echo、记录或提交密钥。
- 用户也可以选择在终端执行 `export VIDEO_DB_API_KEY=<key>`。

### 3. 授权托管型 MCP 服务（仅限 Claude Code 插件）

插件内置了位于 `https://mcp.videodb.io/mcp` 的托管型 MCP 服务。提示用户运行 `/mcp`，选择 **videodb** 并完成浏览器授权。

## 快速参考 (Quick Reference)

### 上传媒体

```python
# URL
video = coll.upload(url="https://example.com/video.mp4")

# YouTube
video = coll.upload(url="https://www.youtube.com/watch?v=VIDEO_ID")

# 本地文件
video = coll.upload(file_path="/path/to/video.mp4")
```

### 理解 → 索引 → 检索（默认路径）

```python
import time

# 1. 理解（Understand）
understanding = video.understand(
    analyzers=[
        {"type": "spoken_words", "name": "transcript"},
        {"type": "vlm", "name": "scene",
         "config": {"prompt": "Describe the scene and any on-screen text."}},
    ],
    segmentation={"type": "shot", "threshold": 30},
)

deadline = time.time() + 3600
while time.time() < deadline:
    analyzers = understanding.refresh().list_analyzers()
    if analyzers and all(a.is_complete for a in analyzers):
        break
    time.sleep(15)

# 2. 为每个成功的分析器产物创建索引
for analyzer in understanding.list_analyzers():
    if analyzer.is_successful:
        video.index(source=analyzer, name=analyzer.name).wait_until_complete()

# 3. 检索（Retrieve）
response = video.search("discussion about pricing")
for shot in response.shots:
    print(f"[{shot.start:.1f}s - {shot.end:.1f}s] {shot.text}")
if response.response_type in ("shots", "deepsearch") and len(response):
    stream_url = response.compile()
```

### 检索功能

```python
# 针对特定索引进行语义搜索，并设置相关性阈值
video.semantic_search("a customer holding the product", index_names=["scene"], score_threshold=0.7)

# 基于字段的精准匹配过滤
video.query(index_name="objects",
            filter=[{"field": "frames.detections.label", "op": "contains", "value": "car"}])

# 聚合统计
video.aggregate(index_name="objects", group_by="frames.detections.label", metric="count")

# 针对视频的问答
answer = video.ask("What did they say about pricing?", include_sources=True)
```

### 转录与字幕

```python
video.generate_transcript()
text = video.get_transcript_text()
stream_url = video.add_subtitle()
```

### 时间线编辑

```python
from videodb.editor import Timeline, Track, Clip, VideoAsset, AudioAsset

timeline = Timeline(conn)
timeline.resolution = "1280x720"

video_track = Track()
video_track.add_clip(0, Clip(asset=VideoAsset(id=video.id, start=10), duration=20))

audio_track = Track()
audio_track.add_clip(0, Clip(asset=AudioAsset(id=music.id, volume=0.2), duration=20))

timeline.add_track(video_track)
timeline.add_track(audio_track)
stream_url = timeline.generate_stream()
```

### 画面比例重塑（适配社交媒体）

```python
from videodb import ReframeMode

reframed = video.reframe(start=0, end=60, target="vertical", mode=ReframeMode.smart)
```

### 沙箱计算（运行开源权重模型）

```python
from videodb import SandboxTier, SandboxModel

sandbox = conn.create_sandbox(
    tier=SandboxTier.medium,
    models=[SandboxModel.GEMMA_4_31B.value],
)
sandbox.wait_for_ready(timeout=300, interval=5)

understanding = video.understand(analyzers=[{
    "type": "vlm", "name": "scene",
    "config": {"model": "google/gemma-4-31B-it", "sandbox_id": sandbox.id,
               "prompt": "Describe the scene."},
}])

sandbox.stop()
sandbox.wait_for_stop()
```

## 错误处理 (Error handling)

```python
from videodb.exceptions import AuthenticationError, InvalidRequestError

try:
    conn = videodb.connect()
except AuthenticationError:
    print("Check your VIDEO_DB_API_KEY")

try:
    video = coll.upload(url="https://example.com/video.mp4")
except InvalidRequestError as e:
    print(f"Upload failed: {e}")
```

## 反模式 (Anti-Patterns)

- 当 VideoDB 支持服务器端操作时，不要使用 ffmpeg、moviepy 等本地编码工具。
- 切勿打印、提交或泄漏 `VIDEO_DB_API_KEY`。
- 新项目不要使用遗留的 v1 索引方式（`index_spoken_words()`, `index_scenes()`）；请使用 v2 的 `understand() -> index() -> retrieve()` 流程。
- 不要在包含部分成功分析器的任务上直接调用 `wait_until_complete()`；应轮询单个分析器。
- 在耗时较长的操作过程中不要重复发起写入；应轮询指定的结果 URL 直至完成。

## 补充文档 (Additional docs)

详细文档位于 `reference/` 目录中：

- [reference/api-reference.md](reference/api-reference.md) - VideoDB Python SDK 完整 API 参考
- [reference/indexing.md](reference/indexing.md) - 理解与索引流水线指南
- [reference/search.md](reference/search.md) - 检索指南
- [reference/editor.md](reference/editor.md) - 时间线编辑工作流
- [reference/sandbox.md](reference/sandbox.md) - 沙箱计算指南
- [reference/capture.md](reference/capture.md) - 桌面捕获工作流
