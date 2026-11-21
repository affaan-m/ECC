---
name: videodb
description: Set up VideoDB and write code against the VideoDB Python SDK. Use for "setup videodb" or "/videodb setup", when the user wants Python code, a script or a notebook rather than a chat answer, for bulk uploading or indexing a folder or library of media, for sandbox compute with open-weight models, and for any video task that video-search, video-clips, video-subtitles, video-edit and video-live do not cover. Screen recording belongs to video-live, AI-generated music, voiceover, images or video to video-edit, and dubbing to video-subtitles.
metadata:
  origin: ECC
allowed-tools: Read Grep Glob Bash(python:*)
argument-hint: "[task description]"
---

# VideoDB: setup and the Python SDK

VideoDB runs video work on its servers: ingest, understand, index, search, clip, subtitle, compose, stream. This skill covers setup and the Python SDK. Five smaller skills cover the common jobs and should be used first when they match:

| Job | Skill |
|---|---|
| Find a moment, ask a video, count what appears | `video-search` |
| Clips, highlight reels, vertical cuts, MP4s | `video-clips` |
| Transcripts, subtitles, translation | `video-subtitles` |
| Music, overlays, captions, compositions | `video-edit` |
| Cameras, live streams, meetings, screen capture | `video-live` |

## When to Activate

- Set up VideoDB ("setup videodb" or "/videodb setup")
- Write code against the VideoDB Python SDK (scripts, notebooks, pipelines)
- Bulk upload or build searchable indexes across media libraries
- Sandbox Compute with self-hosted / open-weight models (Gemma, Qwen, Whisper, FLUX)
- Any programmatic video task (search, transcription, clipping, transcoding, streaming, live video alerts)

## Which path

1. **VideoDB connector tools present** (names such as `upload_media`, `search_video`, `generate_clip`): use them. This is the path in Claude chat on web, desktop and mobile, and in Cowork. No install, no API key.
2. **No VideoDB tools, but you have a shell** (Claude Code, Cowork, any agent that can run Python): ask for the VideoDB API key in one friendly line (free at https://console.videodb.io, $20 of credits, no card). When the user gives it, save it yourself to the project's `.env` (Setup, below), never print it, and continue with the SDK. In Claude Code, `/mcp` then authorizing the bundled videodb server also works.
3. **No VideoDB tools and no shell**: you are in Claude chat. Reply with only this, adapted to the request: "VideoDB isn't connected yet. Open Settings → Connectors, find VideoDB, click Connect and log in (free, no card). Then send this request again and I'll take it from there." Do not mention API keys, `.env`, shells, Claude Code or `/mcp` here; none of them apply in chat, and a key pasted into chat cannot be used because nothing runs code there.

The SDK path is also the only path for code, scripts, notebooks, desktop capture, AI generation, dubbing and sandbox compute, which the connector does not do. Talking to the user: never write "index", "indexed" or "indexing" in a reply; say "searchable".

Long connector jobs return `status: processing`. The reply carries an `output_url` and names the tool to poll (`poll_with`, or `retry_with` on older servers). Call that tool with the `output_url` until it is `done`; several `processing` replies in a row are normal (a 10-minute YouTube upload takes about five), and a `done` reply with an empty result means poll once more. Never re-run the write; that starts a second job.

## Outputs

- **Stream URL**, playable at `https://console.videodb.io/player?url={STREAM_URL}`; connector tools also return a `player_url`
- Search results with timestamps and playable evidence
- Generated assets: subtitles, audio, images, clips
- Event and alert payloads for live streams
- Desktop session summaries and searchable timelines

## Running Python code

**CRITICAL:** Always `cd` to the user's project directory before running Python code. This ensures `load_dotenv(".env")` finds the correct `.env` file.

```python
from dotenv import load_dotenv
load_dotenv(".env")

import videodb
conn = videodb.connect()
```

This reads `VIDEO_DB_API_KEY` from:
1. Environment (if already exported)
2. Project's `.env` file in current directory

If the key is missing, `videodb.connect()` raises `AuthenticationError` automatically.

Do NOT write a script file when a short inline command works.

When writing inline Python (`python -c "..."`), always use properly formatted code — use semicolons to separate statements and keep it readable. For anything longer than ~3 statements, use a heredoc instead:

```bash
python << 'EOF'
from dotenv import load_dotenv
load_dotenv(".env")

import videodb
conn = videodb.connect()
coll = conn.get_collection()
print(f"Videos: {len(coll.get_videos())}")
EOF
```

## Setup

When the user asks to "setup videodb" or similar:

### 1. Install SDK

```bash
pip install "videodb[capture]>=0.5.0" python-dotenv
```

If `videodb[capture]` fails on Linux, install without the capture extra:

```bash
pip install "videodb>=0.5.0" python-dotenv
```

The `>=0.5.0` pin matters — the understand/index/ask/aggregate APIs do not exist in earlier versions.

### 2. Configure API key

Ask the user for their VideoDB API key in one line: free at https://console.videodb.io, $20 of free credits, no credit card. When they give it to you, in chat or any other way, save it for them and keep going:

- Write `VIDEO_DB_API_KEY=<key>` to the project's `.env` (create the file if needed) and make sure `.env` is listed in `.gitignore`.
- Never print, echo, log or commit the key, and never send it anywhere except through the SDK.
- If they prefer to set it themselves, `export VIDEO_DB_API_KEY=<key>` in the terminal also works.

Tell them what you saved and where, without repeating the key.

### 3. Authorize the hosted MCP server (Claude Code plugin only)

The plugin bundles the hosted MCP server at `https://mcp.videodb.io/mcp`, which is
authorized separately from the SDK key above. Tell the user to run `/mcp`, select
**videodb**, and complete browser authorization with their VideoDB account. Verify with
"list my VideoDB collections".

The MCP tools need no local Python install and no API key. Skip this step when the skill
was installed with `npx skills add` or is running outside Claude Code — there is no MCP
server in that case, and the SDK path above is the only one available.

## Quick Reference

### Upload media

```python
# URL
video = coll.upload(url="https://example.com/video.mp4")

# YouTube
video = coll.upload(url="https://www.youtube.com/watch?v=VIDEO_ID")

# Local file
video = coll.upload(file_path="/path/to/video.mp4")
```

### Understand → index → retrieve (default path)

Three stages. Run analyzers to produce **artifacts**, index each artifact, then retrieve.

```python
import time

# 1. Understand. Naming each analyzer keeps `analyzer.name` meaningful downstream.
understanding = video.understand(
    analyzers=[
        {"type": "spoken_words", "name": "transcript"},
        {"type": "vlm", "name": "scene",
         "config": {"prompt": "Describe the scene and any on-screen text."}},
    ],
    segmentation={"type": "shot", "threshold": 30},
)

# A run with a failed or skipped analyzer ends `partial`, which the SDK does not
# treat as terminal — wait_until_complete() would poll to TimeoutError. Poll the
# analyzers instead. The `analyzers and` guard is load-bearing: a refresh can
# transiently return an empty list, and all([]) is True, which would exit the
# loop while the run is still going.
deadline = time.time() + 3600
while time.time() < deadline:
    analyzers = understanding.refresh().list_analyzers()
    if analyzers and all(a.is_complete for a in analyzers):
        break
    time.sleep(15)

# 2. Index each artifact that succeeded.
for analyzer in understanding.list_analyzers():
    if analyzer.is_successful:
        video.index(source=analyzer, name=analyzer.name).wait_until_complete()

# 3. Retrieve.
response = video.search("discussion about pricing")
for shot in response.shots:
    print(f"[{shot.start:.1f}s - {shot.end:.1f}s] {shot.text}")
if response.response_type in ("shots", "deepsearch") and len(response):
    stream_url = response.compile()   # raises SearchError otherwise
```

Analyzer types: `spoken_words` (→ artifact `transcript`), `vlm` (→ `scene`), `object_detection` (→ `objects`), `ocr`, `brand_detection` (→ `brands`), `activity_recognition` (→ `activity`), `location_detection` (→ `location`), `faces`, `audio_event_detection`. They are plain strings — there is no SDK enum.

See [reference/indexing.md](reference/indexing.md) for segmentation, sampling, field configuration, and cost tuning.

### Retrieval

`search(query)` is the default — it plans the retrieval and picks the indexes itself. Reach past it when you need something specific:

```python
# Target a specific index, with a relevance floor
video.semantic_search("a customer holding the product", index_names=["scene"], score_threshold=0.7)

# Exact filtering, no natural-language interpretation
video.query(index_name="objects",
            filter=[{"field": "frames.detections.label", "op": "contains", "value": "car"}])

# Counts and facets — returns the raw server payload, not a SearchResult
video.aggregate(index_name="objects", group_by="frames.detections.label", metric="count")

# A written answer plus the moments it came from
answer = video.ask("What did they say about pricing?", include_sources=True)
```

All five exist on `Collection` too, fanning out across every indexed video. See [reference/search.md](reference/search.md).

**`search()` now returns `SearchResponse`, not `SearchResult`.** `get_shots()`, `compile()`, `play()`, and iteration all work, but there is no `.stream_url` on it — use `.compile()`.

### Transcript + subtitle

```python
video.generate_transcript()          # returns the existing transcript if there is one; force=True re-runs it
text = video.get_transcript_text()
stream_url = video.add_subtitle()
```

`add_subtitle()` and `CaptionAsset(src="auto")` read the video's transcript. `generate_transcript()` creates it, and a `spoken_words` analyzer run from `understand()` counts too. The legacy `index_spoken_words()` is not needed for subtitles or captions.

### Legacy indexing (existing codebases)

```python
# v1 API, legacy. Only for codebases that already use it; new code uses understand() + index() above.
from videodb import IndexType

video.index_spoken_words(force=True)
scene_index_id = video.index_scenes(prompt="Describe the visual content.")
results = video.legacy_search(
    "person writing on a whiteboard",
    index_type=IndexType.scene,
    scene_index_id=scene_index_id,
)
```

Recognise this pattern in existing repos and leave it alone unless asked to migrate — it still works. See [reference/migration.md](reference/migration.md) to port it, or [reference/legacy/search.md](reference/legacy/search.md) to maintain it.

### Timeline editing

Use the Editor API to compose videos, images, audio, and text. See [reference/editor.md](reference/editor.md) for full workflow.

```python
from videodb.editor import Timeline, Track, Clip, VideoAsset, ImageAsset, AudioAsset, Fit

timeline = Timeline(conn)
timeline.resolution = "1280x720"

video_track = Track()
video_track.add_clip(0, Clip(asset=VideoAsset(id=video.id, start=10), duration=20))

audio_track = Track()
audio_track.add_clip(0, Clip(asset=AudioAsset(id=music.id, volume=0.2), duration=20))

timeline.add_track(video_track)
timeline.add_track(audio_track)
stream_url = timeline.generate_stream()
```

### Transcode video (resolution / quality change)

```python
from videodb import TranscodeMode, VideoConfig, AudioConfig

# Change resolution, quality, or aspect ratio server-side
job_id = conn.transcode(
    source="https://example.com/video.mp4",
    callback_url="https://example.com/webhook",
    mode=TranscodeMode.economy,
    video_config=VideoConfig(resolution=720, quality=23, aspect_ratio="16:9"),
    audio_config=AudioConfig(mute=False),
)
```

### Reframe aspect ratio (for social platforms)

**Warning:** `reframe()` is a slow server-side operation. For long videos it can take
several minutes and may time out. Best practices:
- Always limit to a short segment using `start`/`end` when possible
- For full-length videos, use `callback_url` for async processing
- Trim the video on a `Timeline` first, then reframe the shorter result

```python
from videodb import ReframeMode

# Always prefer reframing a short segment:
reframed = video.reframe(start=0, end=60, target="vertical", mode=ReframeMode.smart)

# Async reframe for full-length videos (returns None, result via webhook):
video.reframe(target="vertical", callback_url="https://example.com/webhook")

# Presets: "vertical" (9:16), "square" (1:1), "landscape" (16:9)
reframed = video.reframe(start=0, end=60, target="square")

# Custom dimensions
reframed = video.reframe(start=0, end=60, target={"width": 1280, "height": 720})
```

### Generative media

```python
image = coll.generate_image(
    prompt="a sunset over mountains",
    aspect_ratio="16:9",
)
```

### Sandbox Compute (self-hosted / open-weight models)

Run open-weight models (Gemma, Qwen, Whisper, OmniVoice, FLUX, RT-DETR) by creating a sandbox and passing `sandbox_id` to a supported job. Requires `videodb>=0.5.1`.

```python
from videodb import SandboxTier, SandboxModel

# 1. Create a sandbox sized for the largest model, then wait until active.
sandbox = conn.create_sandbox(
    tier=SandboxTier.medium,
    models=[SandboxModel.GEMMA_4_31B.value],   # exact ID, NO -FP8 suffix
)
sandbox.wait_for_ready(timeout=300, interval=5)

# 2. Understanding: set config.model + config.sandbox_id on the analyzer.
understanding = video.understand(analyzers=[{
    "type": "vlm", "name": "scene",
    "config": {"model": "google/gemma-4-31B-it", "sandbox_id": sandbox.id,
               "prompt": "Describe the scene."},
}])

# 2b. Generation: pass model_name + sandbox_id (jobs return GenerationJob → .wait()).
response = coll.generate_text(prompt="Summarize this.", model_name="Qwen/Qwen3.5-9B",
                             sandbox_id=sandbox.id, max_tokens=300)
job = coll.generate_image(prompt="a city at sunset", model_name="black-forest-labs/FLUX.1-dev",
                          sandbox_id=sandbox.id)
image = job.wait(timeout=900, interval=5)

# 3. Stop when done — provisioning/active/alert all count toward the tier limit.
sandbox.stop(); sandbox.wait_for_stop()
```

Model IDs must match the catalog exactly (**no `-FP8` suffix**) or `create_sandbox` raises `Unsupported sandbox model`. See [reference/sandbox.md](reference/sandbox.md) for the full model catalog, tiers, categories, pricing, and pitfalls.

## Error handling

```python
from videodb.exceptions import AuthenticationError, InvalidRequestError

try:
    conn = videodb.connect()
except AuthenticationError:
    print("Check your VIDEO_DB_API_KEY")

try:
    video = coll.upload(url="https://example.com/video.mp4")
except InvalidRequestError as e:
    print(f"Upload failed: {e}")
```

### Common pitfalls

| Scenario | Error message | Solution |
|----------|--------------|----------|
| Search result has no stream URL | `AttributeError: 'SearchResponse' object has no attribute 'stream_url'` | `search()` returns `SearchResponse` in 0.5.0. Use `results.compile()` |
| `search(score_threshold=)` searches the wrong indexes | no error, unexpected results | `score_threshold` does not route to legacy. Use `semantic_search(score_threshold=)`, or `legacy_search()` for v1 indexes |
| Semantic index on object detection | `use_for includes semantic but no scene has embeddable text` | Object artifacts have no top-level text. Omit `use_for` (it degrades automatically) or pass `["query", "aggregate"]` |
| Indexing a field that does not exist | `fields.filter names not present in any scene's data` | The error lists the available field names — read it. Or check `index.field_schema` |
| Search finds no matches | v2 returns an empty `SearchResponse`; only `legacy_search()` raises `InvalidRequestError: No results found` | Check `len(response)`. Wrap only legacy calls in try/except |
| Legacy `index_spoken_words()` on an already-indexed video (v1) | `Spoken word index for video already exists` | Pass `force=True`, or drop the call: subtitles and captions only need `generate_transcript()` |
| Reframe times out | Blocks indefinitely on long videos | Use `start`/`end` to limit segment, or pass `callback_url` for async |
| Negative timestamps on Timeline | Silently produces broken stream | Always validate `start >= 0` before creating `VideoAsset` |
| `generate_video()` / `create_collection()` fails | `Operation not allowed` or `maximum limit` | Plan-gated features — inform the user about plan limits |

## Anti-Patterns

- Do not use ffmpeg, moviepy, or local encoding tools when VideoDB supports the operation server-side.
- Do not print, echo, commit, or leak the `VIDEO_DB_API_KEY`.
- Do not use legacy v1 indexing (`index_spoken_words()`, `index_scenes()`) for new codebases; use the v2 `understand() -> index() -> retrieve()` pipeline.
- Do not call `wait_until_complete()` on partial analyzer runs; poll individual analyzers.
- Do not re-run writes during long processing operations; poll with the designated output URL until done.

## Additional docs

Reference documentation is in `reference/` relative to this SKILL.md.

- [reference/api-reference.md](reference/api-reference.md) - Complete VideoDB Python SDK API reference
- [reference/indexing.md](reference/indexing.md) - Understand → index pipeline: analyzers, artifacts, segmentation, field configuration
- [reference/indexing-reference.md](reference/indexing-reference.md) - Analyzer catalog and Understanding/Index class reference
- [reference/search.md](reference/search.md) - Retrieval guide: search, ask, semantic_search, query, aggregate
- [reference/search-reference.md](reference/search-reference.md) - Retrieval signatures, filter syntax, response objects
- [reference/migration.md](reference/migration.md) - v1 → v2 mapping and SDK 0.5.0 breaking changes. Read when you find v1 code
- [reference/editor.md](reference/editor.md) - Timeline editing workflow guide (4-layer model, use cases, examples)
- [reference/editor-reference.md](reference/editor-reference.md) - Editor code reference (constructors, parameters, enums)
- [reference/streaming.md](reference/streaming.md) - HLS streaming and instant playback
- [reference/generative.md](reference/generative.md) - AI-powered media generation (images, video, audio)
- [reference/sandbox.md](reference/sandbox.md) - Sandbox Compute workflow (run open-weight models: Gemma, Qwen, Whisper, OmniVoice, FLUX, RT-DETR)
- [reference/sandbox-reference.md](reference/sandbox-reference.md) - Sandbox code reference (create/get/list/stop, tiers, model catalog, sandbox-aware generation)
- [reference/rtstream.md](reference/rtstream.md) - Live stream ingestion workflow (RTSP/RTMP)
- [reference/rtstream-reference.md](reference/rtstream-reference.md) - RTStream SDK methods and AI pipelines
- [reference/capture.md](reference/capture.md) - Desktop capture workflow
- [reference/capture-reference.md](reference/capture-reference.md) - Capture SDK and WebSocket events
- [reference/use-cases.md](reference/use-cases.md) - Common video processing patterns and examples

Legacy v1 indexing and search. These APIs still work and are not deprecated, but read these only when maintaining existing v1 code:

- [reference/legacy/index.md](reference/legacy/index.md) - v1 scene indexing and frame extraction workflow
- [reference/legacy/index-reference.md](reference/legacy/index-reference.md) - v1 scene index code reference (SceneCollection/Scene/Frame)
- [reference/legacy/search.md](reference/legacy/search.md) - v1 spoken-word and scene search

## Screen Recording (Desktop Capture)

Use an event listener to capture WebSocket events during recording sessions. Desktop capture runs on **macOS** and **Windows**.

### Quick Start

1. **Start listener**: save the listener from [reference/capture-reference.md](reference/capture-reference.md#event-persistence) as `videodb_ws_listener.py` in the project, then run `python videodb_ws_listener.py --clear &` from the project root
2. **Get WebSocket ID**: `cat /tmp/videodb_ws_id`
3. **Run capture code** (see reference/capture.md for full workflow)
4. **Events written to**: `/tmp/videodb_events.jsonl`

### Query Events

```python
import json
events = [json.loads(l) for l in open("/tmp/videodb_events.jsonl")]

# Get all transcripts
transcripts = [e["data"]["text"] for e in events if e.get("channel") == "transcript"]

# Get visual descriptions from last 5 minutes
import time
cutoff = time.time() - 300
recent_visual = [e for e in events 
                 if e.get("channel") == "visual_index" and e["unix_ts"] > cutoff]
```

For complete capture workflow, see [reference/capture.md](reference/capture.md).

**Do not use ffmpeg, moviepy, or local encoding tools** when VideoDB supports the operation. The following are all handled server-side by VideoDB — trimming, combining clips, overlaying audio or music, adding subtitles, text/image overlays, transcoding, resolution changes, aspect-ratio conversion, resizing for platform requirements, transcription, volume control, fade transitions, and media generation. Only fall back to local tools for operations listed under Limitations in reference/editor.md (speed changes, crop/zoom, colour grading, keyframe animation).

### When to use what

| Problem | VideoDB solution |
|---------|-----------------|
| Make a video searchable | `video.understand(analyzers=[...])` then `video.index(source=analyzer)` |
| Find moments by what was said or shown | `video.search(query)`, or `semantic_search(index_names=[...])` to target an index |
| Answer a question about a video | `video.ask(question, include_sources=True)` |
| Count or group what appears in a video | `video.aggregate(index_name=..., group_by=..., metric="count")` |
| Filter moments on exact field values | `video.query(index_name=..., filter={...})` |
| Platform rejects video aspect ratio or resolution | `video.reframe()` or `conn.transcode()` with `VideoConfig` |
| Need to resize video for Twitter/Instagram/TikTok | `video.reframe(target="vertical")` or `target="square"` |
| Need to change resolution (e.g. 1080p → 720p) | `conn.transcode()` with `VideoConfig(resolution=720)` |
| Need to overlay audio/music on video | `AudioAsset` on an Editor `Timeline` with volume control |
| Need to add subtitles | `video.add_subtitle()` or `CaptionAsset` on Editor `Timeline` |
| Need to combine/trim clips | `VideoAsset` on an Editor `Timeline` |
| Need to compose images with voiceover | `ImageAsset` + `AudioAsset` on separate Editor tracks |
| Need to generate voiceover, music, or SFX | `coll.generate_voice()`, `generate_music()`, `generate_sound_effect()` |
