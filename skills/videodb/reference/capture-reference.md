# Capture Reference

Code-level details for VideoDB capture sessions. For workflow guide, see [capture.md](capture.md).

---

## WebSocket Events

Real-time events from capture sessions and AI pipelines. No webhooks or polling required.

Use [scripts/ws_listener.py](../scripts/ws_listener.py) to connect and dump events to `${VIDEODB_EVENTS_DIR:-$HOME/.local/state/videodb}/videodb_events.jsonl`.

### Event Channels

| Channel | Source | Content |
|---------|--------|---------|
| `capture_session` | Session lifecycle | Status changes |
| `transcript` | `start_transcript()` | Speech-to-text |
| `visual_index` / `scene_index` | `index_visuals()` | Visual analysis |
| `audio_index` | `index_audio()` | Audio analysis |
| `alert` | `create_alert()` | Alert notifications |

### Session Lifecycle Events

| Event | Status | Key Data |
|-------|--------|----------|
| `capture_session.created` | `created` | — |
| `capture_session.starting` | `starting` | — |
| `capture_session.active` | `active` | `rtstreams[]` |
| `capture_session.stopping` | `stopping` | — |
| `capture_session.stopped` | `stopped` | — |
| `capture_session.exported` | `exported` | `exported_video_id`, `stream_url`, `player_url` |
| `capture_session.failed` | `failed` | `error` |

### Event Structures

**Transcript event:**
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

**Visual index event:**
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

**Audio index event:**
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

**Session active event:**
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

**Session exported event:**
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

> For latest details, see [VideoDB Realtime Context docs](https://docs.videodb.io/pages/ingest/capture-sdks/realtime-context.md).

---

## Event Persistence

Use `ws_listener.py` to dump all WebSocket events to a JSONL file for later analysis.

### Start Listener and Get WebSocket ID

```bash
# Start with --clear to clear old events (recommended for new sessions)
python scripts/ws_listener.py --clear &

# Append to existing events (for reconnects)
python scripts/ws_listener.py &
```

Or specify a custom output directory:

```bash
python scripts/ws_listener.py --clear /path/to/output &
# Or via environment variable:
VIDEODB_EVENTS_DIR=/path/to/output python scripts/ws_listener.py --clear &
```

The script outputs `WS_ID=<connection_id>` on the first line, then listens indefinitely.

**Get the ws_id:**
```bash
cat "${VIDEODB_EVENTS_DIR:-$HOME/.local/state/videodb}/videodb_ws_id"
```

**Stop the listener:**
```bash
kill "$(cat "${VIDEODB_EVENTS_DIR:-$HOME/.local/state/videodb}/videodb_ws_pid")"
```

**Functions that accept `ws_connection_id`:**

| Function | Purpose |
|----------|---------|
| `conn.create_capture_session()` | Session lifecycle events |
| RTStream methods | See [rtstream-reference.md](rtstream-reference.md) |

**Output files** (in output directory, default `${XDG_STATE_HOME:-$HOME/.local/state}/videodb`):
- `videodb_ws_id` - WebSocket connection ID
- `videodb_events.jsonl` - All events
- `videodb_ws_pid` - Process ID for easy termination

**Features:**
- `--clear` flag to clear events file on start (use for new sessions)
- Auto-reconnect with exponential backoff on connection drops
- Graceful shutdown on SIGINT/SIGTERM
- Connection status logging

### JSONL Format

Each line is a JSON object with added timestamps:

```json
{"ts": "2026-03-02T10:15:30.123Z", "unix_ts": 1772446530.123, "channel": "visual_index", "data": {"text": "..."}}
{"ts": "2026-03-02T10:15:31.456Z", "unix_ts": 1772446531.456, "event": "capture_session.active", "capture_session_id": "cap-xxx"}
```

### Reading Events

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

---

## WebSocket Connection

Connect to receive real-time AI results from transcription and indexing pipelines.

```python
ws_wrapper = conn.connect_websocket()
ws = await ws_wrapper.connect()
ws_id = ws.connection_id
```

| Property / Method | Type | Description |
|-------------------|------|-------------|
| `ws.connection_id` | `str` | Unique connection ID (pass to AI pipeline methods) |
| `ws.receive()` | `AsyncIterator[dict]` | Async iterator yielding real-time messages |

---

## CaptureSession

### Connection Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `conn.create_capture_session(end_user_id, collection_id, ws_connection_id, metadata)` | `CaptureSession` | Create a new capture session |
| `conn.get_capture_session(capture_session_id)` | `CaptureSession` | Retrieve an existing capture session |
| `conn.generate_client_token()` | `str` | Generate a client-side authentication token |

### Create a Capture Session

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

> **Note:** `end_user_id` is required and identifies the user initiating the capture. For testing or demo purposes, any unique string identifier works (e.g., `"demo-user"`, `"test-123"`).

### CaptureSession Properties

| Property | Type | Description |
|----------|------|-------------|
| `session.id` | `str` | Unique capture session ID |

### CaptureSession Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `session.get_rtstream(type)` | `list[RTStream]` | Get RTStreams by type: `"mic"`, `"screen"`, or `"system_audio"` |

### Generate a Client Token

```python
token = conn.generate_client_token()
```

---

## CaptureClient

The client runs on the user's machine and handles permissions, channel discovery, and streaming.

```python
from videodb.capture import CaptureClient

client = CaptureClient(client_token=token)
```

### CaptureClient Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `await client.request_permission(type)` | `None` | Request device permission (`"microphone"`, `"screen_capture"`) |
| `await client.list_channels()` | `Channels` | Discover available audio/video channels |
| `await client.start_capture_session(capture_session_id, channels, primary_video_channel_id)` | `None` | Start streaming selected channels |
| `await client.stop_capture()` | `None` | Gracefully stop the capture session |
| `await client.shutdown()` | `None` | Clean up client resources |

### Request Permissions

```python
await client.request_permission("microphone")
await client.request_permission("screen_capture")
```

### Start a Session

```python
selected_channels = [c for c in [mic, display, system_audio] if c]
await client.start_capture_session(
    capture_session_id=session.id,
    channels=selected_channels,
    primary_video_channel_id=display.id if display else None,
)
```

### Stop a Session

```python
await client.stop_capture()
await client.shutdown()
```

---

## Channels

Returned by `client.list_channels()`. Groups available devices by type.

```python
channels = await client.list_channels()
for ch in channels.all():
    print(f"  {ch.id} ({ch.type}): {ch.name}")

mic = channels.mics.default
display = channels.displays.default
system_audio = channels.system_audio.default
```

### Channel Groups

| Property | Type | Description |
|----------|------|-------------|
| `channels.mics` | `ChannelGroup` | Available microphones |
| `channels.displays` | `ChannelGroup` | Available screen displays |
| `channels.system_audio` | `ChannelGroup` | Available system audio sources |

### ChannelGroup Methods & Properties

| Member | Type | Description |
|--------|------|-------------|
| `group.default` | `Channel` | Default channel in the group (or `None`) |
| `group.all()` | `list[Channel]` | All channels in the group |

### Channel Properties

| Property | Type | Description |
|----------|------|-------------|
| `ch.id` | `str` | Unique channel ID |
| `ch.type` | `str` | Channel type (`"mic"`, `"display"`, `"system_audio"`) |
| `ch.name` | `str` | Human-readable channel name |
| `ch.store` | `bool` | Whether to persist the recording (set to `True` to save) |

Without `store = True`, streams are processed in real-time but not saved.

---

## RTStreams and AI Pipelines

After session is active, retrieve RTStream objects with `session.get_rtstream()`.

For RTStream methods (indexing, transcription, alerts, batch config), see [rtstream-reference.md](rtstream-reference.md).

---

## Session Lifecycle

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
