# Capture 指南

## 概述

VideoDB Capture 支持实时屏幕和音频录制，并具备 AI 处理能力。桌面捕获目前仅支持 **macOS**。

关于代码层面的详细信息（SDK 方法、事件结构、AI 管道），请参阅 [capture-reference.md](capture-reference.md)。

## 快速开始

1. **启动 WebSocket 监听器**：`python scripts/ws_listener.py --clear &`
2. **运行捕获代码**（见下方完整捕获工作流）
3. **事件写入到**：`/tmp/videodb_events.jsonl`

***

## 完整捕获工作流

无需 webhook 或轮询。WebSocket 会传递所有事件，包括会话生命周期事件。

> **关键提示：** `CaptureClient` 必须在整个捕获期间持续运行。它运行本地录制器二进制文件，将屏幕/音频数据流式传输到 VideoDB。如果创建 `CaptureClient` 的 Python 进程退出，录制器二进制文件将被终止，捕获会静默停止。请始终将捕获代码作为**长期运行的后台进程**运行（例如 `nohup python capture_script.py &`），并使用信号处理（`asyncio.Event` + `SIGINT`/`SIGTERM`）来保持其存活，直到您明确停止它。

1. 在后台**启动 WebSocket 监听器**，使用 `--clear` 标志来清除旧事件。等待其创建 WebSocket ID 文件。

2. **读取 WebSocket ID**。此 ID 是捕获会话和 AI 管道所必需的。

3. **创建捕获会话**，并为桌面客户端生成客户端令牌。

4. 使用令牌**初始化 CaptureClient**。请求麦克风和屏幕捕获权限。

5. **列出并选择通道**（麦克风、显示器、系统音频）。在您希望持久化为视频的通道上设置 `store = True`。

6. 使用选定的通道**启动会话**。

7. 通过读取事件直到看到 `capture_session.active` 来**等待会话激活**。此事件包含 `rtstreams` 数组。将会话信息（会话 ID、RTStream ID）保存到文件（例如 `/tmp/videodb_capture_info.json`），以便其他脚本可以读取。

8. **保持进程存活**。使用 `asyncio.Event` 配合 `SIGINT`/`SIGTERM` 的信号处理器来阻塞进程，直到显式停止。写入一个 PID 文件（例如 `/tmp/videodb_capture_pid`），以便稍后可以使用 `kill $(cat /tmp/videodb_capture_pid)` 停止该进程。PID 文件应在每次运行时被覆盖，以便重新运行时始终具有正确的 PID。

9. **启动 AI 管道**（在单独的命令/脚本中）对每个 RTStream 进行音频索引和视觉索引。从保存的会话信息文件中读取 RTStream ID。

10. **编写自定义事件处理逻辑**（在单独的命令/脚本中），根据您的用例读取实时事件。示例：
    * 当 `visual_index` 提到 "Slack" 时记录 Slack 活动
    * 当 `audio_index` 事件到达时总结讨论
    * 当 `transcript` 中出现特定关键词时触发警报
    * 从屏幕描述中跟踪应用程序使用情况

11. **停止捕获** - 完成后，向捕获进程发送 SIGTERM。它应在信号处理器中调用 `client.stop_capture()` 和 `client.shutdown()`。

12. **等待导出** - 通过读取事件直到看到 `capture_session.exported`。此事件包含 `exported_video_id`、`stream_url` 和 `player_url`。这可能在停止捕获后需要几秒钟。

13. **停止 WebSocket 监听器** - 收到导出事件后，使用 `kill $(cat /tmp/videodb_ws_pid)` 来干净地终止它。

***

## 关机顺序

正确的关机顺序对于确保捕获所有事件非常重要：

1. **停止捕获会话** — `client.stop_capture()` 然后 `client.shutdown()`
2. **等待导出事件** — 轮询 `/tmp/videodb_events.jsonl` 以查找 `capture_session.exported`
3. **停止 WebSocket 监听器** — `kill $(cat /tmp/videodb_ws_pid)`

在收到导出事件之前，请**不要**杀死 WebSocket 监听器，否则您将错过最终的视频 URL。

***

## 脚本

| 脚本 | 描述 |
|--------|-------------|
| `scripts/ws_listener.py` | WebSocket 事件监听器（转储为 JSONL） |

### ws\_listener.py 用法

```bash
# Start listener in background (append to existing events)
python scripts/ws_listener.py &

# Start listener with clear (new session, clears old events)
python scripts/ws_listener.py --clear &

# Custom output directory
python scripts/ws_listener.py --clear /path/to/events &

# Stop the listener
kill $(cat /tmp/videodb_ws_pid)
```

**选项：**

* `--clear`：在启动前清除事件文件。启动新捕获会话时使用。

**输出文件：**

* `videodb_events.jsonl` - 所有 WebSocket 事件
* `videodb_ws_id` - WebSocket 连接 ID（用于 `ws_connection_id` 参数）
* `videodb_ws_pid` - 进程 ID（用于停止监听器）

**功能：**

* 连接断开时自动重连，并采用指数退避
* 收到 SIGINT/SIGTERM 时优雅关机
* PID 文件，便于进程管理
* 连接状态日志记录
