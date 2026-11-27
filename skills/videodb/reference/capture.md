# Capture Guide

## Overview

VideoDB Capture enables real-time screen and audio recording with AI processing. Desktop capture currently supports **macOS** only.

For code-level details (SDK methods, event structures, AI pipelines), see [capture-reference.md](capture-reference.md).

## Quick Start

1. **Start WebSocket listener**: `python scripts/ws_listener.py --clear &`
2. **Run capture code** (see Complete Capture Workflow below)
3. **Events written to**: `/tmp/videodb_events.jsonl`

---

## Complete Capture Workflow

No webhooks or polling required. WebSocket delivers all events including session lifecycle.

> **CRITICAL:** The `CaptureClient` must remain running for the entire duration of the capture. It runs the local recorder binary that streams screen/audio data to VideoDB. If the Python process that created the `CaptureClient` exits, the recorder binary is killed and capture stops silently. Always run the capture code as a **long-lived background process** (e.g. `nohup python capture_script.py &`) and use signal handling (`asyncio.Event` + `SIGINT`/`SIGTERM`) to keep it alive until you explicitly stop it.

1. **Start WebSocket listener** in background with `--clear` flag to clear old events. Wait for it to create the WebSocket ID file.

2. **Read the WebSocket ID**. This ID is required for capture session and AI pipelines.

3. **Create a capture session** and generate a client token for the desktop client.

4. **Initialize CaptureClient** with the token. Request permissions for microphone and screen capture.

5. **List and select channels** (mic, display, system_audio). Set `store = True` on channels you want to persist as a video.

6. **Start the session** with selected channels.

7. **Wait for session active** by reading events until you see `capture_session.active`. This event contains the `rtstreams` array. Save session info (session ID, RTStream IDs) to a file (e.g. `/tmp/videodb_capture_info.json`) so other scripts can read it.

8. **Keep the process alive.** Use `asyncio.Event` with signal handlers for `SIGINT`/`SIGTERM` to block until explicitly stopped. Write a PID file (e.g. `/tmp/videodb_capture_pid`) so the process can be stopped later with `kill $(cat /tmp/videodb_capture_pid)`. The PID file should be overwritten on every run so reruns always have the correct PID.

9. **Start AI pipelines** (in a separate command/script) on each RTStream for audio indexing and visual indexing. Read the RTStream IDs from the saved session info file.

10. **Write custom event processing logic** (in a separate command/script) to read real-time events based on your use case. Examples:
    - Log Slack activity when `visual_index` mentions "Slack"
    - Summarize discussions when `audio_index` events arrive
    - Trigger alerts when specific keywords appear in `transcript`
    - Track application usage from screen descriptions

11. **Stop capture** when done — send SIGTERM to the capture process. It should call `client.stop_capture()` and `client.shutdown()` in its signal handler.

12. **Wait for export** by reading events until you see `capture_session.exported`. This event contains `exported_video_id`, `stream_url`, and `player_url`. This may take several seconds after stopping capture.

13. **Stop WebSocket listener** after receiving the export event. Use `kill $(cat /tmp/videodb_ws_pid)` to cleanly terminate it.

---

## Shutdown Sequence

Proper shutdown order is important to ensure all events are captured:

1. **Stop the capture session** — `client.stop_capture()` then `client.shutdown()`
2. **Wait for export event** — poll `/tmp/videodb_events.jsonl` for `capture_session.exported`
3. **Stop the WebSocket listener** — `kill $(cat /tmp/videodb_ws_pid)`

Do NOT kill the WebSocket listener before receiving the export event, or you will miss the final video URLs.

---

## Scripts

| Script | Description |
|--------|-------------|
| `scripts/ws_listener.py` | WebSocket event listener (dumps to JSONL) |

### ws_listener.py Usage

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

**Options:**
- `--clear`: Clear the events file before starting. Use when starting a new capture session.

**Output files:**
- `videodb_events.jsonl` - All WebSocket events
- `videodb_ws_id` - WebSocket connection ID (for `ws_connection_id` parameter)
- `videodb_ws_pid` - Process ID (for stopping the listener)

**Features:**
- Auto-reconnect with exponential backoff on connection drops
- Graceful shutdown on SIGINT/SIGTERM
- PID file for easy process management
- Connection status logging
