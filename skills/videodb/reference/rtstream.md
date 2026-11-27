# RTStream Guide

## Overview

RTStream enables real-time ingestion of live video streams (RTSP/RTMP) and desktop capture sessions. Once connected, you can record, index, search, and export content from live sources.

For code-level details (SDK methods, parameters, examples), see [rtstream-reference.md](rtstream-reference.md).

## Use Cases

- **Security & Monitoring**: Connect RTSP cameras, detect events, trigger alerts
- **Live Broadcasts**: Ingest RTMP streams, index in real-time, enable instant search
- **Meeting Recording**: Capture desktop screen and audio, transcribe live, export recordings
- **Event Processing**: Monitor live feeds, run AI analysis, respond to detected content

## Quick Start

1. **Connect to a live stream** (RTSP/RTMP URL) or get RTStream from a capture session

2. **Start ingestion** to begin recording the live content

3. **Start AI pipelines** for real-time indexing (audio, visual, transcription)

4. **Monitor events** via WebSocket for live AI results and alerts

5. **Stop ingestion** when done

6. **Export to video** for permanent storage and further processing

7. **Search the recording** to find specific moments

## RTStream Sources

### From RTSP/RTMP Streams

Connect directly to a live video source:

```python
rtstream = coll.connect_rtstream(
    url="rtmp://your-stream-server/live/stream-key",
    name="My Live Stream",
)
```

### From Capture Sessions

Get RTStreams from desktop capture (mic, screen, system audio):

```python
session = conn.get_capture_session(session_id)

mics = session.get_rtstream("mic")
displays = session.get_rtstream("screen")
system_audios = session.get_rtstream("system_audio")
```

For capture session workflow, see [capture.md](capture.md).

---

## Scripts

| Script | Description |
|--------|-------------|
| `scripts/ws_listener.py` | WebSocket event listener for real-time AI results |
