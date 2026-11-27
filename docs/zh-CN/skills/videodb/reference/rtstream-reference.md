# RTStream 参考

RTStream 操作的代码级详情。工作流程指南请参阅 [rtstream.md](rtstream.md)。
有关使用指导和流程选择，请从 [../SKILL.md](../SKILL.md) 开始。

基于 [docs.videodb.io](https://docs.videodb.io/pages/ingest/live-streams/realtime-apis.md)。

***

## Collection RTStream 方法

`Collection` 上用于管理 RTStream 的方法：

| 方法 | 返回 | 描述 |
|--------|---------|-------------|
| `coll.connect_rtstream(url, name, ...)` | `RTStream` | 从 RTSP/RTMP URL 创建新的 RTStream |
| `coll.get_rtstream(id)` | `RTStream` | 通过 ID 获取现有的 RTStream |
| `coll.list_rtstreams(limit, offset, status, name, ordering)` | `List[RTStream]` | 列出集合中的所有 RTStream |
| `coll.search(query, namespace="rtstream")` | `RTStreamSearchResult` | 在所有 RTStream 中搜索 |

### 连接 RTStream

```python
import videodb

conn = videodb.connect()
coll = conn.get_collection()

rtstream = coll.connect_rtstream(
    url="rtmp://your-stream-server/live/stream-key",
    name="My Live Stream",
    media_types=["video"],  # or ["audio", "video"]
    sample_rate=30,         # optional
    store=True,             # enable recording storage for export
    enable_transcript=True, # optional
    ws_connection_id=ws_id, # optional, for real-time events
)
```

### 获取现有 RTStream

```python
rtstream = coll.get_rtstream("rts-xxx")
```

### 列出 RTStream

```python
rtstreams = coll.list_rtstreams(
    limit=10,
    offset=0,
    status="connected",  # optional filter
    name="meeting",      # optional filter
    ordering="-created_at",
)

for rts in rtstreams:
    print(f"{rts.id}: {rts.name} - {rts.status}")
```

### 从捕获会话获取

捕获会话激活后，检索 RTStream 对象：

```python
session = conn.get_capture_session(session_id)

mics = session.get_rtstream("mic")
displays = session.get_rtstream("screen")
system_audios = session.get_rtstream("system_audio")
```

或使用 `capture_session.active` WebSocket 事件中的 `rtstreams` 数据：

```python
for rts in rtstreams:
    rtstream = coll.get_rtstream(rts["rtstream_id"])
```

***

## RTStream 方法

| 方法 | 返回 | 描述 |
|--------|---------|-------------|
| `rtstream.start()` | `None` | 开始摄取 |
| `rtstream.stop()` | `None` | 停止摄取 |
| `rtstream.generate_stream(start, end)` | `str` | 流式传输录制的片段（Unix 时间戳） |
| `rtstream.export(name=None)` | `RTStreamExportResult` | 导出为永久视频 |
| `rtstream.index_visuals(prompt, ...)` | `RTStreamSceneIndex` | 创建带 AI 分析的视觉索引 |
| `rtstream.index_audio(prompt, ...)` | `RTStreamSceneIndex` | 创建带 LLM 摘要的音频索引 |
| `rtstream.list_scene_indexes()` | `List[RTStreamSceneIndex]` | 列出流上的所有场景索引 |
| `rtstream.get_scene_index(index_id)` | `RTStreamSceneIndex` | 获取特定场景索引 |
| `rtstream.search(query, ...)` | `RTStreamSearchResult` | 搜索索引内容 |
| `rtstream.start_transcript(ws_connection_id, engine)` | `dict` | 开始实时转录 |
| `rtstream.get_transcript(page, page_size, start, end, since)` | `dict` | 获取转录页面 |
| `rtstream.stop_transcript(engine)` | `dict` | 停止转录 |

***

## 启动和停止

```python
# Begin ingestion
rtstream.start()

# ... stream is being recorded ...

# Stop ingestion
rtstream.stop()
```

***

## 生成流

使用 Unix 时间戳（而非秒数偏移）从录制内容生成播放流：

```python
import time

start_ts = time.time()
rtstream.start()

# Let it record for a while...
time.sleep(60)

end_ts = time.time()
rtstream.stop()

# Generate a stream URL for the recorded segment
stream_url = rtstream.generate_stream(start=start_ts, end=end_ts)
print(f"Recorded stream: {stream_url}")
```

***

## 导出为视频

将录制的流导出为集合中的永久视频：

```python
export_result = rtstream.export(name="Meeting Recording 2024-01-15")

print(f"Video ID: {export_result.video_id}")
print(f"Stream URL: {export_result.stream_url}")
print(f"Player URL: {export_result.player_url}")
print(f"Duration: {export_result.duration}s")
```

### RTStreamExportResult 属性

| 属性 | 类型 | 描述 |
|----------|------|-------------|
| `video_id` | `str` | 导出视频的 ID |
| `stream_url` | `str` | HLS 流 URL |
| `player_url` | `str` | Web 播放器 URL |
| `name` | `str` | 视频名称 |
| `duration` | `float` | 时长（秒） |

***

## AI 管道

AI 管道处理实时流并通过 WebSocket 发送结果。

### RTStream AI 管道方法

| 方法 | 返回 | 描述 |
|--------|---------|-------------|
| `rtstream.index_audio(prompt, batch_config, ...)` | `RTStreamSceneIndex` | 开始带 LLM 摘要的音频索引 |
| `rtstream.index_visuals(prompt, batch_config, ...)` | `RTStreamSceneIndex` | 开始屏幕内容的视觉索引 |

### 音频索引

以一定间隔生成音频内容的 LLM 摘要：

```python
audio_index = rtstream.index_audio(
    prompt="Summarize what is being discussed",
    batch_config={"type": "word", "value": 50},
    model_name=None,       # optional
    name="meeting_audio",  # optional
    ws_connection_id=ws_id,
)
```

**音频 batch\_config 选项：**

| 类型 | 值 | 描述 |
|------|-------|-------------|
| `"word"` | count | 每 N 个词分段 |
| `"sentence"` | count | 每 N 个句子分段 |
| `"time"` | seconds | 每 N 秒分段 |

示例：

```python
{"type": "word", "value": 50}      # every 50 words
{"type": "sentence", "value": 5}   # every 5 sentences
{"type": "time", "value": 30}      # every 30 seconds
```

结果通过 `audio_index` WebSocket 通道送达。

### 视觉索引

生成视觉内容的 AI 描述：

```python
scene_index = rtstream.index_visuals(
    prompt="Describe what is happening on screen",
    batch_config={"type": "time", "value": 2, "frame_count": 5},
    model_name="basic",
    name="screen_monitor",  # optional
    ws_connection_id=ws_id,
)
```

**参数：**

| 参数 | 类型 | 描述 |
|-----------|------|-------------|
| `prompt` | `str` | AI 模型的指令（支持结构化 JSON 输出） |
| `batch_config` | `dict` | 控制帧采样（见下文） |
| `model_name` | `str` | 模型层级：`"mini"`、`"basic"`、`"pro"`、`"ultra"` |
| `name` | `str` | 索引名称（可选） |
| `ws_connection_id` | `str` | 用于接收结果的 WebSocket 连接 ID |

**视觉 batch\_config：**

| 键 | 类型 | 描述 |
|-----|------|-------------|
| `type` | `str` | 仅 `"time"` 支持视觉索引 |
| `value` | `int` | 窗口大小（秒） |
| `frame_count` | `int` | 每个窗口提取的帧数 |

示例：`{"type": "time", "value": 2, "frame_count": 5}` 每 2 秒采样 5 帧并将其发送到模型。

**结构化 JSON 输出：**

使用请求 JSON 格式的提示语以获得结构化响应：

```python
scene_index = rtstream.index_visuals(
    prompt="""Analyze the screen and return a JSON object with:
{
  "app_name": "name of the active application",
  "activity": "what the user is doing",
  "ui_elements": ["list of visible UI elements"],
  "contains_text": true/false,
  "dominant_colors": ["list of main colors"]
}
Return only valid JSON.""",
    batch_config={"type": "time", "value": 3, "frame_count": 3},
    model_name="pro",
    ws_connection_id=ws_id,
)
```

结果通过 `scene_index` WebSocket 通道送达。

***

## 批处理配置摘要

| 索引类型 | `type` 选项 | `value` | 额外键 |
|---------------|----------------|---------|------------|
| **音频** | `"word"`、`"sentence"`、`"time"` | words/sentences/seconds | - |
| **视觉** | 仅 `"time"` | seconds | `frame_count` |

示例：

```python
# Audio: every 50 words
{"type": "word", "value": 50}

# Audio: every 30 seconds
{"type": "time", "value": 30}

# Visual: 5 frames every 2 seconds
{"type": "time", "value": 2, "frame_count": 5}
```

***

## 转录

通过 WebSocket 进行实时转录：

```python
# Start live transcription
rtstream.start_transcript(
    ws_connection_id=ws_id,
    engine=None,  # optional, defaults to "assemblyai"
)

# Get transcript pages (with optional filters)
transcript = rtstream.get_transcript(
    page=1,
    page_size=100,
    start=None,   # optional: start timestamp filter
    end=None,     # optional: end timestamp filter
    since=None,   # optional: for polling, get transcripts after this timestamp
    engine=None,
)

# Stop transcription
rtstream.stop_transcript(engine=None)
```

转录结果通过 `transcript` WebSocket 通道送达。

***

## RTStreamSceneIndex

当您调用 `index_audio()` 或 `index_visuals()` 时，该方法返回一个 `RTStreamSceneIndex` 对象。此对象表示正在运行的索引，并提供用于管理场景和警报的方法。

```python
# index_visuals returns an RTStreamSceneIndex
scene_index = rtstream.index_visuals(
    prompt="Describe what is on screen",
    ws_connection_id=ws_id,
)

# index_audio also returns an RTStreamSceneIndex
audio_index = rtstream.index_audio(
    prompt="Summarize the discussion",
    ws_connection_id=ws_id,
)
```

### RTStreamSceneIndex 属性

| 属性 | 类型 | 描述 |
|----------|------|-------------|
| `rtstream_index_id` | `str` | 索引的唯一 ID |
| `rtstream_id` | `str` | 父 RTStream 的 ID |
| `extraction_type` | `str` | 提取类型（`time` 或 `transcript`） |
| `extraction_config` | `dict` | 提取配置 |
| `prompt` | `str` | 用于分析的提示语 |
| `name` | `str` | 索引名称 |
| `status` | `str` | 状态（`connected`、`stopped`） |

### RTStreamSceneIndex 方法

| 方法 | 返回 | 描述 |
|--------|---------|-------------|
| `index.get_scenes(start, end, page, page_size)` | `dict` | 获取已索引的场景 |
| `index.start()` | `None` | 启动/恢复索引 |
| `index.stop()` | `None` | 停止索引 |
| `index.create_alert(event_id, callback_url, ws_connection_id)` | `str` | 创建事件检测警报 |
| `index.list_alerts()` | `list` | 列出此索引上的所有警报 |
| `index.enable_alert(alert_id)` | `None` | 启用警报 |
| `index.disable_alert(alert_id)` | `None` | 禁用警报 |

### 获取场景

从索引轮询已索引的场景：

```python
result = scene_index.get_scenes(
    start=None,      # optional: start timestamp
    end=None,        # optional: end timestamp
    page=1,
    page_size=100,
)

for scene in result["scenes"]:
    print(f"[{scene['start']}-{scene['end']}] {scene['text']}")

if result["next_page"]:
    # fetch next page
    pass
```

### 管理场景索引

```python
# List all indexes on the stream
indexes = rtstream.list_scene_indexes()

# Get a specific index by ID
scene_index = rtstream.get_scene_index(index_id)

# Stop an index
scene_index.stop()

# Restart an index
scene_index.start()
```

***

## 事件

事件是可重用的检测规则。创建一次，即可通过警报附加到任何索引。

### 连接事件方法

| 方法 | 返回 | 描述 |
|--------|---------|-------------|
| `conn.create_event(event_prompt, label)` | `str` (event\_id) | 创建检测事件 |
| `conn.list_events()` | `list` | 列出所有事件 |

### 创建事件

```python
event_id = conn.create_event(
    event_prompt="User opened Slack application",
    label="slack_opened",
)
```

### 列出事件

```python
events = conn.list_events()
for event in events:
    print(f"{event['event_id']}: {event['label']}")
```

***

## 警报

警报将事件连接到索引以实现实时通知。当 AI 检测到与事件描述匹配的内容时，会发送警报。

### 创建警报

```python
# Get the RTStreamSceneIndex from index_visuals
scene_index = rtstream.index_visuals(
    prompt="Describe what application is open on screen",
    ws_connection_id=ws_id,
)

# Create an alert on the index
alert_id = scene_index.create_alert(
    event_id=event_id,
    callback_url="https://your-backend.com/alerts",  # for webhook delivery
    ws_connection_id=ws_id,  # for WebSocket delivery (optional)
)
```

**注意：** `callback_url` 是必需的。如果仅使用 WebSocket 交付，请传递空字符串 `""`。

### 管理警报

```python
# List all alerts on an index
alerts = scene_index.list_alerts()

# Enable/disable alerts
scene_index.disable_alert(alert_id)
scene_index.enable_alert(alert_id)
```

### 警报交付

| 方法 | 延迟 | 使用场景 |
|--------|---------|----------|
| WebSocket | 实时 | 仪表板、实时 UI |
| Webhook | < 1 秒 | 服务器到服务器、自动化 |

### WebSocket 警报事件

```json
{
  "channel": "alert",
  "rtstream_id": "rts-xxx",
  "data": {
    "event_label": "slack_opened",
    "timestamp": 1710000012340,
    "text": "User opened Slack application"
  }
}
```

### Webhook 负载

```json
{
  "event_id": "event-xxx",
  "label": "slack_opened",
  "confidence": 0.95,
  "explanation": "User opened the Slack application",
  "timestamp": "2024-01-15T10:30:45Z",
  "start_time": 1234.5,
  "end_time": 1238.0,
  "stream_url": "https://stream.videodb.io/v3/...",
  "player_url": "https://console.videodb.io/player?url=..."
}
```

***

## WebSocket 集成

所有实时 AI 结果均通过 WebSocket 交付。将 `ws_connection_id` 传递给：

* `rtstream.start_transcript()`
* `rtstream.index_audio()`
* `rtstream.index_visuals()`
* `scene_index.create_alert()`

### WebSocket 通道

| 通道 | 来源 | 内容 |
|---------|--------|---------|
| `transcript` | `start_transcript()` | 实时语音转文本 |
| `scene_index` | `index_visuals()` | 视觉分析结果 |
| `audio_index` | `index_audio()` | 音频分析结果 |
| `alert` | `create_alert()` | 警报通知 |

有关 WebSocket 事件结构和 ws\_listener 用法，请参阅 [capture-reference.md](capture-reference.md)。

***

## 完整工作流程

```python
import time
import videodb
from videodb.exceptions import InvalidRequestError

conn = videodb.connect()
coll = conn.get_collection()

# 1. Connect and start recording
rtstream = coll.connect_rtstream(
    url="rtmp://your-stream-server/live/stream-key",
    name="Weekly Standup",
    store=True,
)
rtstream.start()

# 2. Record for the duration of the meeting
start_ts = time.time()
time.sleep(1800)  # 30 minutes
end_ts = time.time()
rtstream.stop()

# Generate an immediate playback URL for the captured window
stream_url = rtstream.generate_stream(start=start_ts, end=end_ts)
print(f"Recorded stream: {stream_url}")

# 3. Export to a permanent video
export_result = rtstream.export(name="Weekly Standup Recording")
print(f"Exported video: {export_result.video_id}")

# 4. Index the exported video for search
video = coll.get_video(export_result.video_id)
video.index_spoken_words(force=True)

# 5. Search for action items
try:
    results = video.search("action items and next steps")
    stream_url = results.compile()
    print(f"Action items clip: {stream_url}")
except InvalidRequestError as exc:
    if "No results found" in str(exc):
        print("No action items were detected in the recording.")
    else:
        raise
```
