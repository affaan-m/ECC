# 捕获参考

VideoDB 捕获会话的代码级详情。工作流程指南请参阅 [capture.md](capture.md)。

***

## WebSocket 事件

来自捕获会话和 AI 流水线的实时事件。无需 webhook 或轮询。

使用 [scripts/ws\_listener.py](../../../../../skills/videodb/scripts/ws_listener.py) 连接并将事件转储到 `${VIDEODB_EVENTS_DIR:-$HOME/.local/state/videodb}/videodb_events.jsonl`。

### 事件通道

| 通道 | 来源 | 内容 |
|---------|--------|---------|
| `capture_session` | 会话生命周期 | 状态变更 |
| `transcript` | `start_transcript()` | 语音转文字 |
| `visual_index` / `scene_index` | `index_visuals()` | 视觉分析 |
| `audio_index` | `index_audio()` | 音频分析 |
| `alert` | `create_alert()` | 警报通知 |

### 会话生命周期事件

| 事件 | 状态 | 关键数据 |
|-------|--------|----------|
| `capture_session.created` | `created` | — |
| `capture_session.starting` | `starting` | — |
| `capture_session.active` | `active` | `rtstreams[]` |
| `capture_session.stopping` | `stopping` | — |
| `capture_session.stopped` | `stopped` | — |
| `capture_session.exported` | `exported` | `exported_video_id`, `stream_url`, `player_url` |
| `capture_session.failed` | `failed` | `error` |

### 事件结构

**转录事件：**

```json
{
  "channel": "transcript",
  "rtstream_id": "rts-xxx",
  "rtstream_name": "mic:default",
  "data": {
    "text": "Let's schedule the meeting for Thursday",
    "is_final": true,
    "start": 1710000001234,
    "end": 1710000002345
  }
}
```

**视觉索引事件：**

```json
{
  "channel": "visual_index",
  "rtstream_id": "rts-xxx",
  "rtstream_name": "display:1",
  "data": {
    "text": "User is viewing a Slack conversation with 3 unread messages",
    "start": 1710000012340,
    "end": 1710000018900
  }
}
```

**音频索引事件：**

```json
{
  "channel": "audio_index",
  "rtstream_id": "rts-xxx",
  "rtstream_name": "mic:default",
  "data": {
    "text": "Discussion about scheduling a team meeting",
    "start": 1710000021500,
    "end": 1710000029200
  }
}
```

**会话激活事件：**

```json
{
  "event": "capture_session.active",
  "capture_session_id": "cap-xxx",
  "status": "active",
  "data": {
    "rtstreams": [
      { "rtstream_id": "rts-1", "name": "mic:default", "media_types": ["audio"] },
      { "rtstream_id": "rts-2", "name": "system_audio:default", "media_types": ["audio"] },
      { "rtstream_id": "rts-3", "name": "display:1", "media_types": ["video"] }
    ]
  }
}
```

**会话导出事件：**

```json
{
  "event": "capture_session.exported",
  "capture_session_id": "cap-xxx",
  "status": "exported",
  "data": {
    "exported_video_id": "v_xyz789",
    "stream_url": "https://stream.videodb.io/...",
    "player_url": "https://console.videodb.io/player?url=..."
  }
}
```

> 有关最新详情，请参阅 [VideoDB 实时上下文文档](https://docs.videodb.io/pages/ingest/capture-sdks/realtime-context.md)。

***

## 事件持久化

使用 `ws_listener.py` 将所有 WebSocket 事件转储到 JSONL 文件以供后续分析。

### 启动监听器并获取 WebSocket ID

```bash
# Start with --clear to clear old events (recommended for new sessions)
python scripts/ws_listener.py --clear &

# Append to existing events (for reconnects)
python scripts/ws_listener.py &
```

或者指定自定义输出目录：

```bash
python scripts/ws_listener.py --clear /path/to/output &
# Or via environment variable:
VIDEODB_EVENTS_DIR=/path/to/output python scripts/ws_listener.py --clear &
```

脚本在第一行输出 `WS_ID=<connection_id>`，然后无限期监听。

**获取 ws\_id：**

```bash
cat "${VIDEODB_EVENTS_DIR:-$HOME/.local/state/videodb}/videodb_ws_id"
```

**停止监听器：**

```bash
kill "$(cat "${VIDEODB_EVENTS_DIR:-$HOME/.local/state/videodb}/videodb_ws_pid")"
```

**接受 `ws_connection_id` 的函数：**

| 函数 | 用途 |
|----------|---------|
| `conn.create_capture_session()` | 会话生命周期事件 |
| RTStream 方法 | 参见 [rtstream-reference.md](rtstream-reference.md) |

**输出文件**（位于输出目录中，默认为 `${XDG_STATE_HOME:-$HOME/.local/state}/videodb`）：

* `videodb_ws_id` - WebSocket 连接 ID
* `videodb_events.jsonl` - 所有事件
* `videodb_ws_pid` - 进程 ID，便于终止

**特性：**

* `--clear` 标志，用于在启动时清除事件文件（用于新会话）
* 连接断开时，使用指数退避自动重连
* 在 SIGINT/SIGTERM 时优雅关闭
* 连接状态日志记录

### JSONL 格式

每行是一个添加了时间戳的 JSON 对象：

```json
{"ts": "2026-03-02T10:15:30.123Z", "unix_ts": 1772446530.123, "channel": "visual_index", "data": {"text": "..."}}
{"ts": "2026-03-02T10:15:31.456Z", "unix_ts": 1772446531.456, "event": "capture_session.active", "capture_session_id": "cap-xxx"}
```

### 读取事件

```python
import json
import time
from pathlib import Path

events_path = Path.home() / ".local" / "state" / "videodb" / "videodb_events.jsonl"
transcripts = []
recent = []
visual = []

cutoff = time.time() - 600
with events_path.open(encoding="utf-8") as handle:
    for line in handle:
        event = json.loads(line)
        if event.get("channel") == "transcript":
            transcripts.append(event)
        if event.get("unix_ts", 0) > cutoff:
            recent.append(event)
        if (
            event.get("channel") == "visual_index"
            and "code" in event.get("data", {}).get("text", "").lower()
        ):
            visual.append(event)
```

***

## WebSocket 连接

连接以接收来自转录和索引流水线的实时 AI 结果。

```python
ws_wrapper = conn.connect_websocket()
ws = await ws_wrapper.connect()
ws_id = ws.connection_id
```

| 属性 / 方法 | 类型 | 描述 |
|-------------------|------|-------------|
| `ws.connection_id` | `str` | 唯一连接 ID（传递给 AI 流水线方法） |
| `ws.receive()` | `AsyncIterator[dict]` | 异步迭代器，产生实时消息 |

***

## CaptureSession

### 连接方法

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `conn.create_capture_session(end_user_id, collection_id, ws_connection_id, metadata)` | `CaptureSession` | 创建新的捕获会话 |
| `conn.get_capture_session(capture_session_id)` | `CaptureSession` | 检索现有的捕获会话 |
| `conn.generate_client_token()` | `str` | 生成客户端身份验证令牌 |

### 创建捕获会话

```python
from pathlib import Path

ws_id = (Path.home() / ".local" / "state" / "videodb" / "videodb_ws_id").read_text().strip()

session = conn.create_capture_session(
    end_user_id="user-123",  # required
    collection_id="default",
    ws_connection_id=ws_id,
    metadata={"app": "my-app"},
)
print(f"Session ID: {session.id}")
```

> **注意：** `end_user_id` 是必需的，用于标识发起捕获的用户。用于测试或演示目的时，任何唯一的字符串标识符都有效（例如 `"demo-user"`、`"test-123"`）。

### CaptureSession 属性

| 属性 | 类型 | 描述 |
|----------|------|-------------|
| `session.id` | `str` | 唯一的捕获会话 ID |

### CaptureSession 方法

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `session.get_rtstream(type)` | `list[RTStream]` | 按类型获取 RTStream：`"mic"`、`"screen"` 或 `"system_audio"` |

### 生成客户端令牌

```python
token = conn.generate_client_token()
```

***

## CaptureClient

客户端在用户机器上运行，处理权限、通道发现和流传输。

```python
from videodb.capture import CaptureClient

client = CaptureClient(client_token=token)
```

### CaptureClient 方法

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `await client.request_permission(type)` | `None` | 请求设备权限（`"microphone"`、`"screen_capture"`） |
| `await client.list_channels()` | `Channels` | 发现可用的音频/视频通道 |
| `await client.start_capture_session(capture_session_id, channels, primary_video_channel_id)` | `None` | 开始流式传输选定的通道 |
| `await client.stop_capture()` | `None` | 优雅地停止捕获会话 |
| `await client.shutdown()` | `None` | 清理客户端资源 |

### 请求权限

```python
await client.request_permission("microphone")
await client.request_permission("screen_capture")
```

### 启动会话

```python
selected_channels = [c for c in [mic, display, system_audio] if c]
await client.start_capture_session(
    capture_session_id=session.id,
    channels=selected_channels,
    primary_video_channel_id=display.id if display else None,
)
```

### 停止会话

```python
await client.stop_capture()
await client.shutdown()
```

***

## 通道

由 `client.list_channels()` 返回。按类型分组可用设备。

```python
channels = await client.list_channels()
for ch in channels.all():
    print(f"  {ch.id} ({ch.type}): {ch.name}")

mic = channels.mics.default
display = channels.displays.default
system_audio = channels.system_audio.default
```

### 通道组

| 属性 | 类型 | 描述 |
|----------|------|-------------|
| `channels.mics` | `ChannelGroup` | 可用的麦克风 |
| `channels.displays` | `ChannelGroup` | 可用的屏幕显示器 |
| `channels.system_audio` | `ChannelGroup` | 可用的系统音频源 |

### ChannelGroup 方法与属性

| 成员 | 类型 | 描述 |
|--------|------|-------------|
| `group.default` | `Channel` | 组中的默认通道（或 `None`） |
| `group.all()` | `list[Channel]` | 组中的所有通道 |

### 通道属性

| 属性 | 类型 | 描述 |
|----------|------|-------------|
| `ch.id` | `str` | 唯一的通道 ID |
| `ch.type` | `str` | 通道类型（`"mic"`、`"display"`、`"system_audio"`） |
| `ch.name` | `str` | 人类可读的通道名称 |
| `ch.store` | `bool` | 是否持久化录制（设置为 `True` 以保存） |

没有 `store = True`，流会实时处理但不保存。

***

## RTStream 和 AI 流水线

会话激活后，使用 `session.get_rtstream()` 检索 RTStream 对象。

关于 RTStream 方法（索引、转录、警报、批处理配置），请参阅 [rtstream-reference.md](rtstream-reference.md)。

***

## 会话生命周期

```
  create_capture_session()
          │
          v
  ┌───────────────┐
  │    created     │
  └───────┬───────┘
          │  client.start_capture_session()
          v
  ┌───────────────┐     WebSocket: capture_session.starting
  │   starting     │ ──> Capture channels connect
  └───────┬───────┘
          │
          v
  ┌───────────────┐     WebSocket: capture_session.active
  │    active      │ ──> Start AI pipelines
  └───────┬──────────────┐
          │              │
          │              v
          │      ┌───────────────┐     WebSocket: capture_session.failed
          │      │    failed      │ ──> Inspect error payload and retry setup
          │      └───────────────┘
          │      unrecoverable capture error
          │
          │  client.stop_capture()
          v
  ┌───────────────┐     WebSocket: capture_session.stopping
  │   stopping     │ ──> Finalize streams
  └───────┬───────┘
          │
          v
  ┌───────────────┐     WebSocket: capture_session.stopped
  │   stopped      │ ──> All streams finalized
  └───────┬───────┘
          │  (if store=True)
          v
  ┌───────────────┐     WebSocket: capture_session.exported
  │   exported     │ ──> Access video_id, stream_url, player_url
  └───────────────┘
```
