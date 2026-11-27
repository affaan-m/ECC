# RTStream Reference

Code-level details for RTStream operations. For workflow guide, see [rtstream.md](rtstream.md).
For usage guidance and workflow selection, start with [../SKILL.md](../SKILL.md).

Based on [docs.videodb.io](https://docs.videodb.io/pages/ingest/live-streams/realtime-apis.md).

---

## Collection RTStream Methods

Methods on `Collection` for managing RTStreams:

| Method | Returns | Description |
|--------|---------|-------------|
| `coll.connect_rtstream(url, name, ...)` | `RTStream` | Create new RTStream from RTSP/RTMP URL |
| `coll.get_rtstream(id)` | `RTStream` | Get existing RTStream by ID |
| `coll.list_rtstreams(limit, offset, status, name, ordering)` | `List[RTStream]` | List all RTStreams in collection |
| `coll.search(query, namespace="rtstream")` | `RTStreamSearchResult` | Search across all RTStreams |

### Connect RTStream

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

### Get Existing RTStream

```python
rtstream = coll.get_rtstream("rts-xxx")
```

### List RTStreams

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

### From Capture Session

After a capture session is active, retrieve RTStream objects:

```python
session = conn.get_capture_session(session_id)

mics = session.get_rtstream("mic")
displays = session.get_rtstream("screen")
system_audios = session.get_rtstream("system_audio")
```

Or use the `rtstreams` data from the `capture_session.active` WebSocket event:

```python
for rts in rtstreams:
    rtstream = coll.get_rtstream(rts["rtstream_id"])
```

---

## RTStream Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `rtstream.start()` | `None` | Begin ingestion |
| `rtstream.stop()` | `None` | Stop ingestion |
| `rtstream.generate_stream(start, end)` | `str` | Stream recorded segment (Unix timestamps) |
| `rtstream.export(name=None)` | `RTStreamExportResult` | Export to permanent video |
| `rtstream.index_visuals(prompt, ...)` | `RTStreamSceneIndex` | Create visual index with AI analysis |
| `rtstream.index_audio(prompt, ...)` | `RTStreamSceneIndex` | Create audio index with LLM summarization |
| `rtstream.list_scene_indexes()` | `List[RTStreamSceneIndex]` | List all scene indexes on the stream |
| `rtstream.get_scene_index(index_id)` | `RTStreamSceneIndex` | Get a specific scene index |
| `rtstream.search(query, ...)` | `RTStreamSearchResult` | Search indexed content |
| `rtstream.start_transcript(ws_connection_id, engine)` | `dict` | Start live transcription |
| `rtstream.get_transcript(page, page_size, start, end, since)` | `dict` | Get transcript pages |
| `rtstream.stop_transcript(engine)` | `dict` | Stop transcription |

---

## Starting and Stopping

```python
# Begin ingestion
rtstream.start()

# ... stream is being recorded ...

# Stop ingestion
rtstream.stop()
```

---

## Generating Streams

Use Unix timestamps (not seconds offsets) to generate a playback stream from recorded content:

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

---

## Exporting to Video

Export the recorded stream to a permanent video in the collection:

```python
export_result = rtstream.export(name="Meeting Recording 2024-01-15")

print(f"Video ID: {export_result.video_id}")
print(f"Stream URL: {export_result.stream_url}")
print(f"Player URL: {export_result.player_url}")
print(f"Duration: {export_result.duration}s")
```

### RTStreamExportResult Properties

| Property | Type | Description |
|----------|------|-------------|
| `video_id` | `str` | ID of the exported video |
| `stream_url` | `str` | HLS stream URL |
| `player_url` | `str` | Web player URL |
| `name` | `str` | Video name |
| `duration` | `float` | Duration in seconds |

---

## AI Pipelines

AI pipelines process live streams and send results via WebSocket.

### RTStream AI Pipeline Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `rtstream.index_audio(prompt, batch_config, ...)` | `RTStreamSceneIndex` | Start audio indexing with LLM summarization |
| `rtstream.index_visuals(prompt, batch_config, ...)` | `RTStreamSceneIndex` | Start visual indexing of screen content |

### Audio Indexing

Generate LLM summaries of audio content at intervals:

```python
audio_index = rtstream.index_audio(
    prompt="Summarize what is being discussed",
    batch_config={"type": "word", "value": 50},
    model_name=None,       # optional
    name="meeting_audio",  # optional
    ws_connection_id=ws_id,
)
```

**Audio batch_config options:**

| Type | Value | Description |
|------|-------|-------------|
| `"word"` | count | Segment every N words |
| `"sentence"` | count | Segment every N sentences |
| `"time"` | seconds | Segment every N seconds |

Examples:
```python
{"type": "word", "value": 50}      # every 50 words
{"type": "sentence", "value": 5}   # every 5 sentences
{"type": "time", "value": 30}      # every 30 seconds
```

Results arrive on the `audio_index` WebSocket channel.

### Visual Indexing

Generate AI descriptions of visual content:

```python
scene_index = rtstream.index_visuals(
    prompt="Describe what is happening on screen",
    batch_config={"type": "time", "value": 2, "frame_count": 5},
    model_name="basic",
    name="screen_monitor",  # optional
    ws_connection_id=ws_id,
)
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | `str` | Instructions for the AI model (supports structured JSON output) |
| `batch_config` | `dict` | Controls frame sampling (see below) |
| `model_name` | `str` | Model tier: `"mini"`, `"basic"`, `"pro"`, `"ultra"` |
| `name` | `str` | Name for the index (optional) |
| `ws_connection_id` | `str` | WebSocket connection ID for receiving results |

**Visual batch_config:**

| Key | Type | Description |
|-----|------|-------------|
| `type` | `str` | Only `"time"` is supported for visuals |
| `value` | `int` | Window size in seconds |
| `frame_count` | `int` | Number of frames to extract per window |

Example: `{"type": "time", "value": 2, "frame_count": 5}` samples 5 frames every 2 seconds and sends them to the model.

**Structured JSON output:**

Use a prompt that requests JSON format for structured responses:

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

Results arrive on the `scene_index` WebSocket channel.

---

## Batch Config Summary

| Indexing Type | `type` Options | `value` | Extra Keys |
|---------------|----------------|---------|------------|
| **Audio** | `"word"`, `"sentence"`, `"time"` | words/sentences/seconds | - |
| **Visual** | `"time"` only | seconds | `frame_count` |

Examples:
```python
# Audio: every 50 words
{"type": "word", "value": 50}

# Audio: every 30 seconds
{"type": "time", "value": 30}

# Visual: 5 frames every 2 seconds
{"type": "time", "value": 2, "frame_count": 5}
```

---

## Transcription

Real-time transcription via WebSocket:

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

Transcript results arrive on the `transcript` WebSocket channel.

---

## RTStreamSceneIndex

When you call `index_audio()` or `index_visuals()`, the method returns an `RTStreamSceneIndex` object. This object represents the running index and provides methods for managing scenes and alerts.

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

### RTStreamSceneIndex Properties

| Property | Type | Description |
|----------|------|-------------|
| `rtstream_index_id` | `str` | Unique ID of the index |
| `rtstream_id` | `str` | ID of the parent RTStream |
| `extraction_type` | `str` | Type of extraction (`time` or `transcript`) |
| `extraction_config` | `dict` | Extraction configuration |
| `prompt` | `str` | The prompt used for analysis |
| `name` | `str` | Name of the index |
| `status` | `str` | Status (`connected`, `stopped`) |

### RTStreamSceneIndex Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `index.get_scenes(start, end, page, page_size)` | `dict` | Get indexed scenes |
| `index.start()` | `None` | Start/resume the index |
| `index.stop()` | `None` | Stop the index |
| `index.create_alert(event_id, callback_url, ws_connection_id)` | `str` | Create alert for event detection |
| `index.list_alerts()` | `list` | List all alerts on this index |
| `index.enable_alert(alert_id)` | `None` | Enable an alert |
| `index.disable_alert(alert_id)` | `None` | Disable an alert |

### Getting Scenes

Poll indexed scenes from the index:

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

### Managing Scene Indexes

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

---

## Events

Events are reusable detection rules. Create them once, attach to any index via alerts.

### Connection Event Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `conn.create_event(event_prompt, label)` | `str` (event_id) | Create detection event |
| `conn.list_events()` | `list` | List all events |

### Creating an Event

```python
event_id = conn.create_event(
    event_prompt="User opened Slack application",
    label="slack_opened",
)
```

### Listing Events

```python
events = conn.list_events()
for event in events:
    print(f"{event['event_id']}: {event['label']}")
```

---

## Alerts

Alerts wire events to indexes for real-time notifications. When the AI detects content matching the event description, an alert is sent.

### Creating an Alert

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

**Note:** `callback_url` is required. Pass an empty string `""` if only using WebSocket delivery.

### Managing Alerts

```python
# List all alerts on an index
alerts = scene_index.list_alerts()

# Enable/disable alerts
scene_index.disable_alert(alert_id)
scene_index.enable_alert(alert_id)
```

### Alert Delivery

| Method | Latency | Use Case |
|--------|---------|----------|
| WebSocket | Real-time | Dashboards, live UI |
| Webhook | < 1 second | Server-to-server, automation |

### WebSocket Alert Event

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

### Webhook Payload

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

---

## WebSocket Integration

All real-time AI results are delivered via WebSocket. Pass `ws_connection_id` to:
- `rtstream.start_transcript()`
- `rtstream.index_audio()`
- `rtstream.index_visuals()`
- `scene_index.create_alert()`

### WebSocket Channels

| Channel | Source | Content |
|---------|--------|---------|
| `transcript` | `start_transcript()` | Real-time speech-to-text |
| `scene_index` | `index_visuals()` | Visual analysis results |
| `audio_index` | `index_audio()` | Audio analysis results |
| `alert` | `create_alert()` | Alert notifications |

For WebSocket event structures and ws_listener usage, see [capture-reference.md](capture-reference.md).

---

## Complete Workflow

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
