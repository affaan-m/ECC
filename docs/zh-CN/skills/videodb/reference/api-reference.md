# 完整 API 参考

VideoDB 技能参考材料。关于使用指南和工作流选择，请从 [../SKILL.md](../SKILL.md) 开始。

## 连接

```python
import videodb

conn = videodb.connect(
    api_key="your-api-key",      # or set VIDEO_DB_API_KEY env var
    base_url=None,                # custom API endpoint (optional)
)
```

**返回:** `Connection` 对象

### 连接方法

| 方法 | 返回 | 描述 |
|--------|---------|-------------|
| `conn.get_collection(collection_id="default")` | `Collection` | 获取集合（若无 ID 则获取默认集合） |
| `conn.get_collections()` | `list[Collection]` | 列出所有集合 |
| `conn.create_collection(name, description, is_public=False)` | `Collection` | 创建新集合 |
| `conn.update_collection(id, name, description)` | `Collection` | 更新集合 |
| `conn.check_usage()` | `dict` | 获取账户使用统计 |
| `conn.upload(source, media_type, name, ...)` | `Video\|Audio\|Image` | 上传到默认集合 |
| `conn.record_meeting(meeting_url, bot_name, ...)` | `Meeting` | 录制会议 |
| `conn.create_capture_session(...)` | `CaptureSession` | 创建捕获会话（见 [capture-reference.md](capture-reference.md)） |
| `conn.youtube_search(query, result_threshold, duration)` | `list[dict]` | 搜索 YouTube |
| `conn.transcode(source, callback_url, mode, ...)` | `str` | 转码视频（返回作业 ID） |
| `conn.get_transcode_details(job_id)` | `dict` | 获取转码作业状态和详情 |
| `conn.connect_websocket(collection_id)` | `WebSocketConnection` | 连接到 WebSocket（见 [capture-reference.md](capture-reference.md)） |

### 转码

使用自定义分辨率、质量和音频设置从 URL 转码视频。处理在服务器端进行——无需本地 ffmpeg。

```python
from videodb import TranscodeMode, VideoConfig, AudioConfig

job_id = conn.transcode(
    source="https://example.com/video.mp4",
    callback_url="https://example.com/webhook",
    mode=TranscodeMode.economy,
    video_config=VideoConfig(resolution=720, quality=23),
    audio_config=AudioConfig(mute=False),
)
```

#### transcode 参数

| 参数 | 类型 | 默认值 | 描述 |
|-----------|------|---------|-------------|
| `source` | `str` | 必需 | 要转码的视频 URL（最好是可下载的 URL） |
| `callback_url` | `str` | 必需 | 转码完成时接收回调的 URL |
| `mode` | `TranscodeMode` | `TranscodeMode.economy` | 转码速度：`economy` 或 `lightning` |
| `video_config` | `VideoConfig` | `VideoConfig()` | 视频编码设置 |
| `audio_config` | `AudioConfig` | `AudioConfig()` | 音频编码设置 |

返回一个作业 ID (`str`)。使用 `conn.get_transcode_details(job_id)` 来检查作业状态。

```python
details = conn.get_transcode_details(job_id)
```

#### VideoConfig

```python
from videodb import VideoConfig, ResizeMode

config = VideoConfig(
    resolution=720,              # Target resolution height (e.g. 480, 720, 1080)
    quality=23,                  # Encoding quality (lower = better, default 23)
    framerate=30,                # Target framerate
    aspect_ratio="16:9",         # Target aspect ratio
    resize_mode=ResizeMode.crop, # How to fit: crop, fit, or pad
)
```

| 字段 | 类型 | 默认值 | 描述 |
|-------|------|---------|-------------|
| `resolution` | `int\|None` | `None` | 目标分辨率高度（像素） |
| `quality` | `int` | `23` | 编码质量（值越低，质量越高） |
| `framerate` | `int\|None` | `None` | 目标帧率 |
| `aspect_ratio` | `str\|None` | `None` | 目标宽高比（例如 `"16:9"`, `"9:16"`） |
| `resize_mode` | `str` | `ResizeMode.crop` | 调整大小策略：`crop`, `fit`, 或 `pad` |

#### AudioConfig

```python
from videodb import AudioConfig

config = AudioConfig(mute=False)
```

| 字段 | 类型 | 默认值 | 描述 |
|-------|------|---------|-------------|
| `mute` | `bool` | `False` | 静音音轨 |

## 集合

```python
coll = conn.get_collection()
```

### 集合方法

| 方法 | 返回 | 描述 |
|--------|---------|-------------|
| `coll.get_videos()` | `list[Video]` | 列出所有视频 |
| `coll.get_video(video_id)` | `Video` | 获取特定视频 |
| `coll.get_audios()` | `list[Audio]` | 列出所有音频 |
| `coll.get_audio(audio_id)` | `Audio` | 获取特定音频 |
| `coll.get_images()` | `list[Image]` | 列出所有图像 |
| `coll.get_image(image_id)` | `Image` | 获取特定图像 |
| `coll.upload(url=None, file_path=None, media_type=None, name=None)` | `Video\|Audio\|Image` | 上传媒体 |
| `coll.search(query, search_type, index_type, score_threshold, namespace, scene_index_id, ...)` | `SearchResult` | 在集合中搜索（仅语义搜索；关键词和场景搜索会引发 `NotImplementedError`） |
| `coll.generate_image(prompt, aspect_ratio="1:1")` | `Image` | 使用 AI 生成图像 |
| `coll.generate_video(prompt, duration=5)` | `Video` | 使用 AI 生成视频 |
| `coll.generate_music(prompt, duration=5)` | `Audio` | 使用 AI 生成音乐 |
| `coll.generate_sound_effect(prompt, duration=2)` | `Audio` | 生成音效 |
| `coll.generate_voice(text, voice_name="Default")` | `Audio` | 从文本生成语音 |
| `coll.generate_text(prompt, model_name="basic", response_type="text")` | `dict` | LLM 文本生成——通过 `["output"]` 访问结果 |
| `coll.dub_video(video_id, language_code)` | `Video` | 将视频配音为另一种语言 |
| `coll.record_meeting(meeting_url, bot_name, ...)` | `Meeting` | 录制实时会议 |
| `coll.create_capture_session(...)` | `CaptureSession` | 创建捕获会话（见 [capture-reference.md](capture-reference.md)） |
| `coll.get_capture_session(...)` | `CaptureSession` | 检索捕获会话（见 [capture-reference.md](capture-reference.md)） |
| `coll.connect_rtstream(url, name, ...)` | `RTStream` | 连接到实时流（见 [rtstream-reference.md](rtstream-reference.md)） |
| `coll.make_public()` | `None` | 使集合公开 |
| `coll.make_private()` | `None` | 使集合私有 |
| `coll.delete_video(video_id)` | `None` | 删除视频 |
| `coll.delete_audio(audio_id)` | `None` | 删除音频 |
| `coll.delete_image(image_id)` | `None` | 删除图像 |
| `coll.delete()` | `None` | 删除集合 |

### 上传参数

```python
video = coll.upload(
    url=None,            # Remote URL (HTTP, YouTube)
    file_path=None,      # Local file path
    media_type=None,     # "video", "audio", or "image" (auto-detected if omitted)
    name=None,           # Custom name for the media
    description=None,    # Description
    callback_url=None,   # Webhook URL for async notification
)
```

## 视频对象

```python
video = coll.get_video(video_id)
```

### 视频属性

| 属性 | 类型 | 描述 |
|----------|------|-------------|
| `video.id` | `str` | 唯一视频 ID |
| `video.collection_id` | `str` | 父集合 ID |
| `video.name` | `str` | 视频名称 |
| `video.description` | `str` | 视频描述 |
| `video.length` | `float` | 时长（秒） |
| `video.stream_url` | `str` | 默认流 URL |
| `video.player_url` | `str` | 播放器嵌入 URL |
| `video.thumbnail_url` | `str` | 缩略图 URL |

### 视频方法

| 方法 | 返回 | 描述 |
|--------|---------|-------------|
| `video.generate_stream(timeline=None)` | `str` | 生成流 URL（可选的 `[(start, end)]` 元组时间线） |
| `video.play()` | `str` | 在浏览器中打开流，返回播放器 URL |
| `video.index_spoken_words(language_code=None, force=False)` | `None` | 为语音搜索建立索引。使用 `force=True` 在已建立索引时跳过。 |
| `video.index_scenes(extraction_type, prompt, extraction_config, metadata, model_name, name, scenes, callback_url)` | `str` | 索引视觉场景（返回 scene\_index\_id） |
| `video.index_visuals(prompt, batch_config, ...)` | `str` | 索引视觉内容（返回 scene\_index\_id） |
| `video.index_audio(prompt, model_name, ...)` | `str` | 使用 LLM 索引音频（返回 scene\_index\_id） |
| `video.get_transcript(start=None, end=None)` | `list[dict]` | 获取带时间戳的转录稿 |
| `video.get_transcript_text(start=None, end=None)` | `str` | 获取完整转录文本 |
| `video.generate_transcript(force=None)` | `dict` | 生成转录稿 |
| `video.translate_transcript(language, additional_notes)` | `list[dict]` | 翻译转录稿 |
| `video.search(query, search_type, index_type, filter, **kwargs)` | `SearchResult` | 在视频内搜索 |
| `video.add_subtitle(style=SubtitleStyle())` | `str` | 添加字幕（返回流 URL） |
| `video.generate_thumbnail(time=None)` | `str\|Image` | 生成缩略图 |
| `video.get_thumbnails()` | `list[Image]` | 获取所有缩略图 |
| `video.extract_scenes(extraction_type, extraction_config)` | `SceneCollection` | 提取场景 |
| `video.reframe(start, end, target, mode, callback_url)` | `Video\|None` | 调整视频宽高比 |
| `video.clip(prompt, content_type, model_name)` | `str` | 根据提示生成剪辑（返回流 URL） |
| `video.insert_video(video, timestamp)` | `str` | 在时间戳处插入视频 |
| `video.download(name=None)` | `dict` | 下载视频 |
| `video.delete()` | `None` | 删除视频 |

### 调整宽高比

将视频转换为不同的宽高比，可选智能对象跟踪。处理在服务器端进行。

> **警告：** 调整宽高比是缓慢的服务器端操作。对于长视频可能需要几分钟，并可能超时。始终使用 `start`/`end` 来限制片段，或传递 `callback_url` 进行异步处理。

```python
from videodb import ReframeMode

# Always prefer short segments to avoid timeouts:
reframed = video.reframe(start=0, end=60, target="vertical", mode=ReframeMode.smart)

# Async reframe for full-length videos (returns None, result via webhook):
video.reframe(target="vertical", callback_url="https://example.com/webhook")

# Custom dimensions
reframed = video.reframe(start=0, end=60, target={"width": 1080, "height": 1080})
```

#### reframe 参数

| 参数 | 类型 | 默认值 | 描述 |
|-----------|------|---------|-------------|
| `start` | `float\|None` | `None` | 开始时间（秒）（None = 开始） |
| `end` | `float\|None` | `None` | 结束时间（秒）（None = 视频结束） |
| `target` | `str\|dict` | `"vertical"` | 预设字符串（`"vertical"`, `"square"`, `"landscape"`）或 `{"width": int, "height": int}` |
| `mode` | `str` | `ReframeMode.smart` | `"simple"`（中心裁剪）或 `"smart"`（对象跟踪） |
| `callback_url` | `str\|None` | `None` | 异步通知的 Webhook URL |

当未提供 `callback_url` 时返回 `Video` 对象，否则返回 `None`。

## 音频对象

```python
audio = coll.get_audio(audio_id)
```

### 音频属性

| 属性 | 类型 | 描述 |
|----------|------|-------------|
| `audio.id` | `str` | 唯一音频 ID |
| `audio.collection_id` | `str` | 父集合 ID |
| `audio.name` | `str` | 音频名称 |
| `audio.length` | `float` | 时长（秒） |

### 音频方法

| 方法 | 返回 | 描述 |
|--------|---------|-------------|
| `audio.generate_url()` | `str` | 生成用于播放的签名 URL |
| `audio.get_transcript(start=None, end=None)` | `list[dict]` | 获取带时间戳的转录稿 |
| `audio.get_transcript_text(start=None, end=None)` | `str` | 获取完整转录文本 |
| `audio.generate_transcript(force=None)` | `dict` | 生成转录稿 |
| `audio.delete()` | `None` | 删除音频 |

## 图像对象

```python
image = coll.get_image(image_id)
```

### 图像属性

| 属性 | 类型 | 描述 |
|----------|------|-------------|
| `image.id` | `str` | 唯一图像 ID |
| `image.collection_id` | `str` | 父集合 ID |
| `image.name` | `str` | 图像名称 |
| `image.url` | `str\|None` | 图像 URL（对于生成的图像可能为 `None`——请改用 `generate_url()`） |

### 图像方法

| 方法 | 返回 | 描述 |
|--------|---------|-------------|
| `image.generate_url()` | `str` | 生成签名 URL |
| `image.delete()` | `None` | 删除图像 |

## 时间线与编辑器

### 时间线

```python
from videodb.timeline import Timeline

timeline = Timeline(conn)
```

| 方法 | 返回 | 描述 |
|--------|---------|-------------|
| `timeline.add_inline(asset)` | `None` | 在主轨道上顺序添加 `VideoAsset` |
| `timeline.add_overlay(start, asset)` | `None` | 在时间戳处叠加 `AudioAsset`、`ImageAsset` 或 `TextAsset` |
| `timeline.generate_stream()` | `str` | 编译并获取流 URL |

### 资产类型

#### VideoAsset

```python
from videodb.asset import VideoAsset

asset = VideoAsset(
    asset_id=video.id,
    start=0,              # trim start (seconds)
    end=None,             # trim end (seconds, None = full)
)
```

#### AudioAsset

```python
from videodb.asset import AudioAsset

asset = AudioAsset(
    asset_id=audio.id,
    start=0,
    end=None,
    disable_other_tracks=True,   # mute original audio when True
    fade_in_duration=0,          # seconds (max 5)
    fade_out_duration=0,         # seconds (max 5)
)
```

#### ImageAsset

```python
from videodb.asset import ImageAsset

asset = ImageAsset(
    asset_id=image.id,
    duration=None,        # display duration (seconds)
    width=100,            # display width
    height=100,           # display height
    x=80,                 # horizontal position (px from left)
    y=20,                 # vertical position (px from top)
)
```

#### TextAsset

```python
from videodb.asset import TextAsset, TextStyle

asset = TextAsset(
    text="Hello World",
    duration=5,
    style=TextStyle(
        fontsize=24,
        fontcolor="black",
        boxcolor="white",       # background box colour
        alpha=1.0,
        font="Sans",
        text_align="T",         # text alignment within box
    ),
)
```

#### CaptionAsset（编辑器 API）

CaptionAsset 属于编辑器 API，它有自己的时间线、轨道和剪辑系统：

```python
from videodb.editor import CaptionAsset, FontStyling

asset = CaptionAsset(
    src="auto",                    # "auto" or base64 ASS string
    font=FontStyling(name="Clear Sans", size=30),
    primary_color="&H00FFFFFF",
)
```

完整的 CaptionAsset 用法请见 [editor.md](../../../../../skills/videodb/reference/editor.md#caption-overlays) 中的编辑器 API。

## 视频搜索参数

```python
results = video.search(
    query="your query",
    search_type=SearchType.semantic,       # semantic, keyword, or scene
    index_type=IndexType.spoken_word,      # spoken_word or scene
    result_threshold=None,                 # max number of results
    score_threshold=None,                  # minimum relevance score
    dynamic_score_percentage=None,         # percentage of dynamic score
    scene_index_id=None,                   # target a specific scene index (pass via **kwargs)
    filter=[],                             # metadata filters for scene search
)
```

> **注意：** `filter` 是 `video.search()` 中的一个显式命名参数。`scene_index_id` 通过 `**kwargs` 传递给 API。
>
> **重要：** `video.search()` 在没有匹配项时会引发 `InvalidRequestError`，并附带消息 `"No results found"`。请始终将搜索调用包装在 try/except 中。对于场景搜索，请使用 `score_threshold=0.3` 或更高值来过滤低相关性的噪声。

对于场景搜索，请使用 `search_type=SearchType.semantic` 并设置 `index_type=IndexType.scene`。当针对特定场景索引时，传递 `scene_index_id`。详情请参阅 [search.md](search.md)。

## SearchResult 对象

```python
results = video.search("query", search_type=SearchType.semantic)
```

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `results.get_shots()` | `list[Shot]` | 获取匹配的片段列表 |
| `results.compile()` | `str` | 将所有镜头编译为流 URL |
| `results.play()` | `str` | 在浏览器中打开编译后的流 |

### Shot 属性

| 属性 | 类型 | 描述 |
|----------|------|-------------|
| `shot.video_id` | `str` | 源视频 ID |
| `shot.video_length` | `float` | 源视频时长 |
| `shot.video_title` | `str` | 源视频标题 |
| `shot.start` | `float` | 开始时间（秒） |
| `shot.end` | `float` | 结束时间（秒） |
| `shot.text` | `str` | 匹配的文本内容 |
| `shot.search_score` | `float` | 搜索相关性分数 |

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `shot.generate_stream()` | `str` | 流式传输此特定镜头 |
| `shot.play()` | `str` | 在浏览器中打开镜头流 |

## Meeting 对象

```python
meeting = coll.record_meeting(
    meeting_url="https://meet.google.com/...",
    bot_name="Bot",
    callback_url=None,          # Webhook URL for status updates
    callback_data=None,         # Optional dict passed through to callbacks
    time_zone="UTC",            # Time zone for the meeting
)
```

### Meeting 属性

| 属性 | 类型 | 描述 |
|----------|------|-------------|
| `meeting.id` | `str` | 唯一会议 ID |
| `meeting.collection_id` | `str` | 父集合 ID |
| `meeting.status` | `str` | 当前状态 |
| `meeting.video_id` | `str` | 录制视频 ID（完成后） |
| `meeting.bot_name` | `str` | 机器人名称 |
| `meeting.meeting_title` | `str` | 会议标题 |
| `meeting.meeting_url` | `str` | 会议 URL |
| `meeting.speaker_timeline` | `dict` | 发言人时间线数据 |
| `meeting.is_active` | `bool` | 如果正在初始化或处理中则为真 |
| `meeting.is_completed` | `bool` | 如果已完成则为真 |

### Meeting 方法

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `meeting.refresh()` | `Meeting` | 从服务器刷新数据 |
| `meeting.wait_for_status(target_status, timeout=14400, interval=120)` | `bool` | 轮询直到达到指定状态 |

## RTStream 与 Capture

关于 RTStream（实时摄取、索引、转录），请参阅 [rtstream-reference.md](rtstream-reference.md)。

关于捕获会话（桌面录制、CaptureClient、频道），请参阅 [capture-reference.md](capture-reference.md)。

## 枚举与常量

### SearchType

```python
from videodb import SearchType

SearchType.semantic    # Natural language semantic search
SearchType.keyword     # Exact keyword matching
SearchType.scene       # Visual scene search (may require paid plan)
SearchType.llm         # LLM-powered search
```

### SceneExtractionType

```python
from videodb import SceneExtractionType

SceneExtractionType.shot_based   # Automatic shot boundary detection
SceneExtractionType.time_based   # Fixed time interval extraction
SceneExtractionType.transcript   # Transcript-based scene extraction
```

### SubtitleStyle

```python
from videodb import SubtitleStyle

style = SubtitleStyle(
    font_name="Arial",
    font_size=18,
    primary_colour="&H00FFFFFF",
    bold=False,
    # ... see SubtitleStyle for all options
)
video.add_subtitle(style=style)
```

### SubtitleAlignment 与 SubtitleBorderStyle

```python
from videodb import SubtitleAlignment, SubtitleBorderStyle
```

### TextStyle

```python
from videodb import TextStyle
# or: from videodb.asset import TextStyle

style = TextStyle(
    fontsize=24,
    fontcolor="black",
    boxcolor="white",
    font="Sans",
    text_align="T",
    alpha=1.0,
)
```

### 其他常量

```python
from videodb import (
    IndexType,          # spoken_word, scene
    MediaType,          # video, audio, image
    Segmenter,          # word, sentence, time
    SegmentationType,   # sentence, llm
    TranscodeMode,      # economy, lightning
    ResizeMode,         # crop, fit, pad
    ReframeMode,        # simple, smart
    RTStreamChannelType,
)
```

## 异常

```python
from videodb.exceptions import (
    AuthenticationError,     # Invalid or missing API key
    InvalidRequestError,     # Bad parameters or malformed request
    RequestTimeoutError,     # Request timed out
    SearchError,             # Search operation failure (e.g. not indexed)
    VideodbError,            # Base exception for all VideoDB errors
)
```

| 异常 | 常见原因 |
|-----------|-------------|
| `AuthenticationError` | 缺少或无效的 `VIDEO_DB_API_KEY` |
| `InvalidRequestError` | 无效 URL、不支持的格式、错误参数 |
| `RequestTimeoutError` | 服务器响应时间过长 |
| `SearchError` | 在索引前进行搜索、无效的搜索类型 |
| `VideodbError` | 服务器错误、网络问题、通用故障 |
