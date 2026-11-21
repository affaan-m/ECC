# RTStream Guide

## Overview

RTStream enables real-time ingestion of live video streams (RTSP/RTMP) and desktop capture sessions. Once connected, you can record, index, search, and export content from live sources.

For code-level details (SDK methods, parameters, examples), see [rtstream-reference.md](rtstream-reference.md).

## Contents

- Overview
- Use Cases
- Quick Start
- RTStream Sources
- Understanding & Indexing (v2)
- Legacy RTStream indexing (v1)
- Event Listener

## Use Cases

- **Security & Monitoring**: Connect RTSP cameras, detect events, trigger alerts
- **Live Broadcasts**: Ingest RTMP streams, index in real-time, enable instant search
- **Meeting Recording**: Capture desktop screen and audio, transcribe live, export recordings
- **Event Processing**: Monitor live feeds, run AI analysis, respond to detected content

## Quick Start

1. **Connect to a live stream** (RTSP/RTMP URL) or get RTStream from a capture session

2. **Start ingestion** to begin recording the live content

3. **Run understanding and indexing** (v2) — `rtstream.understand()` then `rtstream.index()`. Or use the v1 AI pipelines (`index_visuals`, `index_audio`, `start_transcript`)

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

## Understanding & Indexing (v2)

Live streams have their own `understand()` and `index()`, mirroring the video pipeline in [indexing.md](indexing.md) but with streaming semantics: the understanding run and the index are long-lived processes you `start()` and `stop()`, and you read results with `get_records()` rather than paginating a finished index.

```python
rtstream = coll.connect_rtstream(url="rtsp://camera/stream", name="Front Door")
rtstream.start()

understanding = rtstream.understand(
    segmentation={"type": "time", "window": "10s"},
    analyzers=[{
        "type": "vlm",
        "name": "scene",
        "sampling": {"frame_count": 5},
        "config": {"prompt": "Describe who and what is visible.", "model": "basic"},
    }],
    store=True,
    ws_connection_id=ws_id,
)

index = rtstream.index(source=understanding.outputs["scene"], name="scene")

records = index.get_records(page_size=50)
```

**Initial support is exactly one `vlm` analyzer with time segmentation.** The multi-analyzer chaining available on videos is not yet available on live streams.

Note `{"type": "time", "window": "10s"}` — the window is a **string with a unit**, unlike the video pipeline's integer `{"type": "time", "seconds": 10}`.

`store=True` persists the analyzer output so it can be indexed later. `use_for` on `rtstream.index()` defaults to `["semantic"]`.

### Alerts on a v2 index

`RTStreamIndex` carries the same alert methods as the v1 `RTStreamSceneIndex`:

```python
event_id = conn.create_event(event_prompt="A person enters the doorway", label="person_entered")
alert_id = index.create_alert(event_id=event_id, callback_url="", ws_connection_id=ws_id)
```

### Method naming

`rtstream.list_understanding()` is **singular**, while the video equivalent is `video.list_understandings()`. Easy to get wrong.

For full signatures and class properties, see [rtstream-reference.md](rtstream-reference.md).

---

## Legacy RTStream indexing (v1)

`index_scenes()`, `index_visuals()`, `index_audio()`, and `RTStreamSceneIndex` still work unchanged and are not deprecated. They remain the documented path for audio indexing and live transcription, which the v2 stream pipeline does not yet cover. See the AI Pipelines section of [rtstream-reference.md](rtstream-reference.md).

---

## Event Listener

To receive real-time AI results over WebSocket, use the listener in [capture-reference.md](capture-reference.md#event-persistence).
