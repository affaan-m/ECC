# RTStream 指南

## 概述

RTStream 支持实时摄取直播视频流（RTSP/RTMP）和桌面捕获会话。连接后，您可以录制、索引、搜索和导出实时源的内容。

有关代码级别的详细信息（SDK 方法、参数、示例），请参阅 [rtstream-reference.md](rtstream-reference.md)。

## 使用场景

* **安防与监控**：连接 RTSP 摄像头，检测事件，触发警报
* **直播广播**：摄取 RTMP 流，实时索引，实现即时搜索
* **会议录制**：捕获桌面屏幕和音频，实时转录，导出录制内容
* **事件处理**：监控实时视频流，运行 AI 分析，响应检测到的内容

## 快速入门

1. **连接到实时流**（RTSP/RTMP URL）或从捕获会话获取 RTStream
2. **开始摄取**以开始录制实时内容
3. **启动 AI 流水线**以进行实时索引（音频、视觉、转录）
4. **通过 WebSocket 监控事件**以获取实时 AI 结果和警报
5. **完成时停止摄取**
6. **导出为视频**以便永久存储和进一步处理
7. **搜索录制内容**以查找特定时刻

## RTStream 来源

### 来自 RTSP/RTMP 流

直接连接到实时视频源：

```python
rtstream = coll.connect_rtstream(
    url="rtmp://your-stream-server/live/stream-key",
    name="My Live Stream",
)
```

### 来自捕获会话

从桌面捕获（麦克风、屏幕、系统音频）获取 RTStream：

```python
session = conn.get_capture_session(session_id)

mics = session.get_rtstream("mic")
displays = session.get_rtstream("screen")
system_audios = session.get_rtstream("system_audio")
```

有关捕获会话的工作流程，请参阅 [capture.md](capture.md)。

***

## 脚本

| 脚本 | 描述 |
|--------|-------------|
| `scripts/ws_listener.py` | 用于实时 AI 结果的 WebSocket 事件监听器 |
