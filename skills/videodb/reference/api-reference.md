# Complete API Reference

Requires `videodb>=0.5.0`.

## Contents

- Connection (methods, transcode, VideoConfig, AudioConfig)
- Collections (methods, upload parameters)
- Video Object (properties, methods, reframe)
- Audio Object
- Image Object
- Understanding & Index Objects (v2)
- Scene Objects
- Timeline & Editor (assets and styles)
- Video Search Parameters
- Search Response Objects
- Meeting Object
- RTStream & Capture
- Enums & Constants (SearchType, IndexCapability, FieldGroup, SceneExtractionType)
- Exceptions

## Connection

```python
import videodb

conn = videodb.connect(
    api_key="your-api-key",      # or set VIDEO_DB_API_KEY env var
    base_url=None,                # custom API endpoint (optional)
)
```

**Returns:** `Connection` object

### Connection Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `conn.get_collection(collection_id="default")` | `Collection` | Get collection (default if no ID) |
| `conn.get_collections()` | `list[Collection]` | List all collections |
| `conn.create_collection(name, description, is_public=False)` | `Collection` | Create new collection |
| `conn.update_collection(id, name, description)` | `Collection` | Update a collection |
| `conn.check_usage()` | `dict` | Get account usage stats |
| `conn.upload(source, media_type, name, ...)` | `Video\|Audio\|Image` | Upload to default collection |
| `conn.record_meeting(meeting_url, bot_name, ...)` | `Meeting` | Record a meeting |
| `conn.create_capture_session(...)` | `CaptureSession` | Create a capture session (see [capture-reference.md](capture-reference.md)) |
| `conn.youtube_search(query, result_threshold, duration)` | `list[dict]` | Search YouTube |
| `conn.transcode(source, callback_url, mode, ...)` | `str` | Transcode video (returns job ID) |
| `conn.get_transcode_details(job_id)` | `dict` | Get transcode job status and details |
| `conn.connect_websocket(collection_id)` | `WebSocketConnection` | Connect to WebSocket (see [capture-reference.md](capture-reference.md)) |

### Transcode

Transcode a video from a URL with custom resolution, quality, and audio settings. Processing happens server-side — no local ffmpeg required.

```python
from videodb import TranscodeMode, VideoConfig, AudioConfig

job_id = conn.transcode(
    source="https://example.com/video.mp4",
    callback_url="https://example.com/webhook",
    mode=TranscodeMode.economy,
    video_config=VideoConfig(resolution=720, quality=23),
    audio_config=AudioConfig(mute=False),
)
```

#### transcode Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `source` | `str` | required | URL of the video to transcode (preferably a downloadable URL) |
| `callback_url` | `str` | required | URL to receive the callback when transcoding completes |
| `mode` | `TranscodeMode` | `TranscodeMode.economy` | Transcoding speed: `economy` or `lightning` |
| `video_config` | `VideoConfig` | `VideoConfig()` | Video encoding settings |
| `audio_config` | `AudioConfig` | `AudioConfig()` | Audio encoding settings |

Returns a job ID (`str`). Use `conn.get_transcode_details(job_id)` to check job status.

```python
details = conn.get_transcode_details(job_id)
```

#### VideoConfig

```python
from videodb import VideoConfig, ResizeMode

config = VideoConfig(
    resolution=720,              # Target resolution height (e.g. 480, 720, 1080)
    quality=23,                  # Encoding quality (lower = better, default 23)
    framerate=30,                # Target framerate
    aspect_ratio="16:9",         # Target aspect ratio
    resize_mode=ResizeMode.crop, # How to fit: crop, fit, or pad
)
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `resolution` | `int\|None` | `None` | Target resolution height in pixels |
| `quality` | `int` | `23` | Encoding quality (lower = higher quality) |
| `framerate` | `int\|None` | `None` | Target framerate |
| `aspect_ratio` | `str\|None` | `None` | Target aspect ratio (e.g. `"16:9"`, `"9:16"`) |
| `resize_mode` | `str` | `ResizeMode.crop` | Resize strategy: `crop`, `fit`, or `pad` |

#### AudioConfig

```python
from videodb import AudioConfig

config = AudioConfig(mute=False)
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mute` | `bool` | `False` | Mute the audio track |

## Collections

```python
coll = conn.get_collection()
```

> **Collection has no `understand()` or `index()`.** Creating artifacts and indexes is video-scoped (and rtstream-scoped). A collection is the fan-out **read** scope: it exposes `search`, `ask`, `semantic_search`, `query`, and `aggregate` over every indexed video it contains. Fan-out works by index name — give the same `name` to the same artifact type on each video. See [indexing.md](indexing.md).

### Collection Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `coll.get_videos()` | `list[Video]` | List all videos |
| `coll.get_video(video_id)` | `Video` | Get specific video |
| `coll.get_audios()` | `list[Audio]` | List all audios |
| `coll.get_audio(audio_id)` | `Audio` | Get specific audio |
| `coll.get_images()` | `list[Image]` | List all images |
| `coll.get_image(image_id)` | `Image` | Get specific image |
| `coll.upload(url=None, file_path=None, media_type=None, name=None)` | `Video\|Audio\|Image` | Upload media |
| `coll.search(query, *args, config=None, **kwargs)` | `SearchResponse\|SearchResult` | Search across the collection. `SearchResponse` on the v2 path |
| `coll.ask(question, top_k, mode, include_sources)` | `AskResponse` | **(v2)** Synthesised answer across the collection |
| `coll.semantic_search(query, index_names, top_k, score_threshold, filter, return_fields, index_ids)` | `SearchResult` | **(v2)** Vector search across the collection |
| `coll.query(index_name, filter, limit, return_fields, sort, index_id)` | `SearchResult` | **(v2)** Exact structured filtering |
| `coll.aggregate(index_name, filter, group_by, metric, limit, sort, index_id)` | `dict\|list[dict]` | **(v2)** Counts, grouping, facets |
| `coll.legacy_search(query, search_type, index_type, namespace, scene_index_id, ...)` | `SearchResult` | **(v1)** Search v1 indexes (semantic only; keyword and scene raise `NotImplementedError`) |
| `coll.generate_image(prompt, aspect_ratio="1:1")` | `Image` | Generate image with AI |
| `coll.generate_video(prompt, duration=5)` | `Video` | Generate video with AI |
| `coll.generate_music(prompt, duration=5)` | `Audio` | Generate music with AI |
| `coll.generate_sound_effect(prompt, duration=2)` | `Audio` | Generate sound effect |
| `coll.generate_voice(text, voice_name="Default")` | `Audio` | Generate speech from text |
| `coll.generate_text(prompt, model_name="basic", response_type="text")` | `dict` | LLM text generation — access result via `["output"]` |
| `coll.dub_video(video_id, language_code)` | `Video` | Dub video into another language |
| `coll.record_meeting(meeting_url, bot_name, ...)` | `Meeting` | Record a live meeting |
| `coll.create_capture_session(...)` | `CaptureSession` | Create a capture session (see [capture-reference.md](capture-reference.md)) |
| `coll.get_capture_session(...)` | `CaptureSession` | Retrieve capture session (see [capture-reference.md](capture-reference.md)) |
| `coll.connect_rtstream(url, name, ...)` | `RTStream` | Connect to a live stream (see [rtstream-reference.md](rtstream-reference.md)) |
| `coll.make_public()` | `None` | Make collection public |
| `coll.make_private()` | `None` | Make collection private |
| `coll.delete_video(video_id)` | `None` | Delete a video |
| `coll.delete_audio(audio_id)` | `None` | Delete an audio |
| `coll.delete_image(image_id)` | `None` | Delete an image |
| `coll.delete()` | `None` | Delete the collection |

### Upload Parameters

```python
video = coll.upload(
    url=None,            # Remote URL (HTTP, YouTube)
    file_path=None,      # Local file path
    media_type=None,     # "video", "audio", or "image" (auto-detected if omitted)
    name=None,           # Custom name for the media
    description=None,    # Description
    callback_url=None,   # Webhook URL for async notification
)
```

## Video Object

```python
video = coll.get_video(video_id)
```

### Video Properties

| Property | Type | Description |
|----------|------|-------------|
| `video.id` | `str` | Unique video ID |
| `video.collection_id` | `str` | Parent collection ID |
| `video.name` | `str` | Video name |
| `video.description` | `str` | Video description |
| `video.length` | `float` | Duration in seconds |
| `video.stream_url` | `str` | Default stream URL |
| `video.player_url` | `str` | Player embed URL |
| `video.thumbnail_url` | `str` | Thumbnail URL |

### Video Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `video.generate_stream(timeline=None)` | `str` | Generate stream URL (optional timeline of `[(start, end)]` tuples) |
| `video.play()` | `str` | Open stream in browser, returns player URL |
| `video.understand(analyzers, segmentation, sampling, transform, audio_chunking, callback_url)` | `Understanding` | **(v2)** Run analyzers to produce artifacts |
| `video.get_understanding(understanding_id)` | `Understanding` | **(v2)** Reopen a run |
| `video.list_understandings()` | `list[Understanding]` | **(v2)** All runs for this video |
| `video.delete_understanding(understanding_id)` | `None` | **(v2)** Delete a run and its artifacts |
| `video.index(source, name, use_for, fields, callback_url)` | `Index` | **(v2)** Build a retrieval index from an artifact |
| `video.get_index(index_id=None, name=None)` | `Index` | **(v2)** Fetch one index |
| `video.list_indexes(use_for=None)` | `list[Index]` | **(v2)** List indexes; `use_for` is a single string |
| `video.delete_index(index_id)` | `None` | **(v2)** Delete an index |
| `video.ask(question, top_k, mode, include_sources)` | `AskResponse` | **(v2)** Synthesised answer grounded in indexed content |
| `video.semantic_search(query, index_names, top_k, score_threshold, filter, return_fields, index_ids)` | `SearchResult` | **(v2)** Vector search against named indexes |
| `video.query(index_name, filter, limit, return_fields, sort, index_id)` | `SearchResult` | **(v2)** Exact structured filtering |
| `video.aggregate(index_name, filter, group_by, metric, limit, sort, index_id)` | `dict\|list[dict]` | **(v2)** Counts, grouping, facets |
| `video.legacy_search(query, search_type, index_type, ...)` | `SearchResult` | **(v1)** Search v1 indexes explicitly |
| `video.index_spoken_words(language_code=None, force=False)` | `None` | **(v1, legacy)** Index speech for `legacy_search()`. Not needed for `add_subtitle()` or `CaptionAsset(src="auto")`, which read the transcript from `generate_transcript()` |
| `video.index_scenes(extraction_type, prompt, extraction_config, metadata, model_name, name, scenes, callback_url)` | `str` | **(v1)** Index visual scenes (returns scene_index_id) |
| `video.index_visuals(prompt, batch_config, ...)` | `str` | **(v1)** Index visuals (returns scene_index_id) |
| `video.index_audio(prompt, model_name, ...)` | `str` | **(v1)** Index audio with LLM (returns scene_index_id) |
| `video.get_transcript(start=None, end=None)` | `list[dict]` | Get timestamped transcript |
| `video.get_transcript_text(start=None, end=None)` | `str` | Get full transcript text |
| `video.generate_transcript(force=None)` | `dict` | Generate transcript |
| `video.translate_transcript(language, additional_notes)` | `list[dict]` | Translate transcript |
| `video.search(query, *args, config=None, **kwargs)` | `SearchResponse\|SearchResult` | Search within video. Returns `SearchResponse` on the v2 path, `SearchResult` when legacy keywords route it to `legacy_search()` |
| `video.add_subtitle(style=SubtitleStyle())` | `str` | Add subtitles (returns stream URL) |
| `video.generate_thumbnail(time=None)` | `str\|Image` | Generate thumbnail |
| `video.get_thumbnails()` | `list[Image]` | Get all thumbnails |
| `video.extract_scenes(extraction_type, extraction_config, force, callback_url)` | `SceneCollection` | Extract scenes with frame images |
| `video.get_scene_index(scene_index_id)` | `list[dict]\|None` | **(v1)** Get scene index records (`start`, `end`, `description`) |
| `video.list_scene_index()` | `list` | **(v1)** List all scene indexes |
| `video.delete_scene_index(scene_index_id)` | `None` | **(v1)** Delete a scene index |
| `video.list_scene_collection()` | `list` | List all scene collections |
| `video.get_scene_collection(collection_id)` | `SceneCollection\|None` | Get scene collection with frames |
| `video.delete_scene_collection(collection_id)` | `None` | Delete a scene collection |
| `video.get_scenes()` | `list\|None` | **Deprecated.** Use `get_scene_index()` instead |
| `video.reframe(start, end, target, mode, callback_url)` | `Video\|None` | Reframe video aspect ratio |
| `video.clip(prompt, content_type, model_name)` | `str` | Generate clip from prompt (returns stream URL) |
| `video.insert_video(video, timestamp)` | `str` | Insert video at timestamp |
| `video.download(name=None)` | `dict` | Download the video |
| `video.delete()` | `None` | Delete the video |

### Reframe

Convert a video to a different aspect ratio with optional smart object tracking. Processing is server-side.

> **Warning:** Reframe is a slow server-side operation. It can take several minutes for long videos and may time out. Always use `start`/`end` to limit the segment, or pass `callback_url` for async processing.

```python
from videodb import ReframeMode

# Always prefer short segments to avoid timeouts:
reframed = video.reframe(start=0, end=60, target="vertical", mode=ReframeMode.smart)

# Async reframe for full-length videos (returns None, result via webhook):
video.reframe(target="vertical", callback_url="https://example.com/webhook")

# Custom dimensions
reframed = video.reframe(start=0, end=60, target={"width": 1080, "height": 1080})
```

#### reframe Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `start` | `float\|None` | `None` | Start time in seconds (None = beginning) |
| `end` | `float\|None` | `None` | End time in seconds (None = end of video) |
| `target` | `str\|dict` | `"vertical"` | Preset string (`"vertical"`, `"square"`, `"landscape"`) or `{"width": int, "height": int}` |
| `mode` | `str` | `ReframeMode.smart` | `"simple"` (centre crop) or `"smart"` (object tracking) |
| `callback_url` | `str\|None` | `None` | Webhook URL for async notification |

Returns a `Video` object when no `callback_url` is provided, `None` otherwise.

## Audio Object

```python
audio = coll.get_audio(audio_id)
```

### Audio Properties

| Property | Type | Description |
|----------|------|-------------|
| `audio.id` | `str` | Unique audio ID |
| `audio.collection_id` | `str` | Parent collection ID |
| `audio.name` | `str` | Audio name |
| `audio.length` | `float` | Duration in seconds |

### Audio Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `audio.generate_url()` | `str` | Generate signed URL for playback |
| `audio.get_transcript(start=None, end=None)` | `list[dict]` | Get timestamped transcript |
| `audio.get_transcript_text(start=None, end=None)` | `str` | Get full transcript text |
| `audio.generate_transcript(force=None)` | `dict` | Generate transcript |
| `audio.delete()` | `None` | Delete the audio |

## Image Object

```python
image = coll.get_image(image_id)
```

### Image Properties

| Property | Type | Description |
|----------|------|-------------|
| `image.id` | `str` | Unique image ID |
| `image.collection_id` | `str` | Parent collection ID |
| `image.name` | `str` | Image name |
| `image.url` | `str\|None` | Image URL (may be `None` for generated images — use `generate_url()` instead) |

### Image Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `image.generate_url()` | `str` | Generate signed URL |
| `image.delete()` | `None` | Delete the image |

## Understanding & Index Objects (v2)

Created by `video.understand()` and `video.index()`. For full detail see [indexing-reference.md](indexing-reference.md).

### Understanding

| Property | Type | Description |
|----------|------|-------------|
| `.id` | `str` | Run ID |
| `.status` | `str` | `queued`, `running`, `done`, `partial`, `failed`. **`partial` is not terminal to the SDK** — see [indexing-reference.md](indexing-reference.md) |
| `.analyzers` | `list[UnderstandingAnalyzer]` | Analyzers in the run |

| Method | Returns | Description |
|--------|---------|-------------|
| `.is_complete` / `.is_successful` | `bool` | Terminal is `done`/`failed`; successful is `done` |
| `.wait_until_complete(timeout=1800, poll_interval=10)` | `Understanding` | Poll to terminal; raises `TimeoutError` |
| `.list_analyzers()` | `list` | Local cache — no network call |
| `.get_analyzer(name_or_id, refresh=False)` | `UnderstandingAnalyzer` | Raises `ValueError` if absent |
| `.get_analyzer_output(name_or_id)` | `Any` | One analyzer's output |
| `.refresh()` / `.delete()` | — | Re-fetch / delete the run |

### UnderstandingAnalyzer

| Property | Type | Description |
|----------|------|-------------|
| `.id` / `.name` / `.type` | `str` | Identity |
| `.status` | `str` | `done`, `failed`, `skipped`, `cancelled`, or in progress |

| Method | Returns | Description |
|--------|---------|-------------|
| `.is_complete` / `.is_successful` | `bool` | Terminal set is wider than `Understanding`'s |
| `.get_output()` | `Any` | The analyzer's output |
| `.to_index_source()` | `dict` | Reference form for `video.index(source=...)` |

### Index

```python
from videodb.index import Index, IndexRecord, RecordPage, FieldSchema
```

Not exported at package level — import from `videodb.index`.

| Property | Type | Description |
|----------|------|-------------|
| `.index_id` / `.name` | `str` | Identity |
| `.status` | `str` | `building`, `ready`, `failed` |
| `.use_for` | `list` | Effective capabilities |
| `.record_count` | `int` | Records indexed |
| `.fields` | `dict` | Group → field names |
| `.field_schema` | `dict[str, FieldSchema]` | Per-field type, groups, operators |
| `.error` | `str\|None` | Failure reason |

| Method | Returns | Description |
|--------|---------|-------------|
| `.is_complete` / `.is_successful` | `bool` | Terminal is `ready`/`failed`; successful is `ready` |
| `.wait_until_complete(timeout=1800, poll_interval=10)` | `Index` | Raises `TimeoutError` |
| `.records(limit=20, cursor=None)` | `RecordPage` | Preview records, cursor-paginated |
| `.refresh()` / `.delete()` | — | Re-fetch / delete the index |

## Scene Objects

Scene collections are v1 and have no v2 equivalent — they remain the only way to get viewable frame image URLs. For workflow guide, see [legacy/index.md](legacy/index.md). For full details, see [legacy/index-reference.md](legacy/index-reference.md).

### SceneCollection

| Property | Type | Description |
|----------|------|-------------|
| `.id` | `str` | Unique collection ID |
| `.video_id` | `str` | Parent video ID |
| `.config` | `dict` | Extraction configuration |
| `.scenes` | `list[Scene]` | List of Scene objects |

| Method | Returns | Description |
|--------|---------|-------------|
| `.delete()` | `None` | Delete this collection |

### Scene

| Property | Type | Description |
|----------|------|-------------|
| `.id` | `str` | Unique scene ID |
| `.start` | `float` | Start time (seconds) |
| `.end` | `float` | End time (seconds) |
| `.description` | `str` | Text description |
| `.frames` | `list[Frame]` | Frame objects with image URLs |
| `.metadata` | `dict` | Scene metadata |

| Method | Returns | Description |
|--------|---------|-------------|
| `.describe(prompt, model_name)` | `str` | Generate AI description |
| `.to_json()` | `dict` | Serialize to dict |

### Frame (extends Image)

| Property | Type | Description |
|----------|------|-------------|
| `.id` | `str` | Unique frame ID |
| `.url` | `str` | Viewable image URL |
| `.frame_time` | `float` | Timestamp in video (seconds) |
| `.description` | `str` | Text description |
| `.scene_id` | `str` | Parent scene ID |
| `.video_id` | `str` | Parent video ID |

| Method | Returns | Description |
|--------|---------|-------------|
| `.generate_url()` | `str` | Generate signed URL |
| `.describe(prompt, model_name)` | `str` | Generate AI description |
| `.to_json()` | `dict` | Serialize to dict |

## Timeline & Editor

### Timeline

```python
from videodb.timeline import Timeline

timeline = Timeline(conn)
```

| Method | Returns | Description |
|--------|---------|-------------|
| `timeline.add_inline(asset)` | `None` | Add `VideoAsset` sequentially on main track |
| `timeline.add_overlay(start, asset)` | `None` | Overlay `AudioAsset`, `ImageAsset`, or `TextAsset` at timestamp |
| `timeline.generate_stream()` | `str` | Compile and get stream URL |

### Asset Types

#### VideoAsset

```python
from videodb.asset import VideoAsset

asset = VideoAsset(
    asset_id=video.id,
    start=0,              # trim start (seconds)
    end=None,             # trim end (seconds, None = full)
)
```

#### AudioAsset

```python
from videodb.asset import AudioAsset

asset = AudioAsset(
    asset_id=audio.id,
    start=0,
    end=None,
    disable_other_tracks=True,   # mute original audio when True
    fade_in_duration=0,          # seconds (max 5)
    fade_out_duration=0,         # seconds (max 5)
)
```

#### ImageAsset

```python
from videodb.asset import ImageAsset

asset = ImageAsset(
    asset_id=image.id,
    duration=None,        # display duration (seconds)
    width=100,            # display width
    height=100,           # display height
    x=80,                 # horizontal position (px from left)
    y=20,                 # vertical position (px from top)
)
```

#### TextAsset

```python
from videodb.asset import TextAsset, TextStyle

asset = TextAsset(
    text="Hello World",
    duration=5,
    style=TextStyle(
        fontsize=24,
        fontcolor="black",
        boxcolor="white",       # background box colour
        alpha=1.0,
        font="Sans",
        text_align="T",         # text alignment within box
    ),
)
```

#### CaptionAsset (Editor API)

CaptionAsset belongs to the Editor API, which has its own Timeline, Track, and Clip system:

```python
from videodb.editor import CaptionAsset, FontStyling

asset = CaptionAsset(
    src="auto",                    # "auto" or base64 ASS string
    font=FontStyling(name="Clear Sans", size=30),
    primary_color="&H00FFFFFF",
)
```

See [editor.md](editor.md#caption-overlays) for full CaptionAsset usage with the Editor API.

## Video Search Parameters

`search()` defaults to v2 and picks its engine by inspecting the arguments you pass.

```python
response = video.search(
    query="your query",
    top_k=10,               # number of results
    mode="default",         # or "deepsearch"
    return_fields=None,     # index rows to hydrate onto each shot
    include_clip=False,     # include a playable clip per result
    session_id=None,        # continue a deepsearch session
    config=None,            # request configuration passthrough
)
```

> **Routing.** Legacy keywords (`search_type`, `index_type`, `result_threshold`, `dynamic_score_percentage`, `scene_index_id`, `index_id`, `algorithm`, `sort_docs_on`, `namespace`, `stitch`, `rerank`, `rerank_params`) or **any positional argument** route the call to `legacy_search()`. Mixing legacy and v2 keywords raises `ValueError`. Passing `index_name` / `index_names` / `index_ids` also raises — `search()` selects indexes automatically; use `semantic_search()` to target them.

> **`score_threshold` and `filter` are in neither set.** They do *not* route to legacy; they are forwarded to v2. Use `semantic_search(score_threshold=...)` for v2, or call `legacy_search(...)` explicitly for v1 indexes.

> v2 search returns an empty response when nothing matches. Only `legacy_search()` raises `InvalidRequestError: "No results found"`.

For the full retrieval surface, see [search.md](search.md) and [search-reference.md](search-reference.md). For v1 search parameters, see [legacy/search.md](legacy/search.md).

## Search Response Objects

### SearchResponse

Returned by v2 `search()`.

| Property | Type | Description |
|----------|------|-------------|
| `.response_type` | `str` | `"shots"`, `"aggregate"`, or `"deepsearch"` |
| `.results` | `SearchResult\|dict\|list` | Shots as a `SearchResult`; raw payload for aggregate |
| `.shots` | `list[Shot]` | Convenience accessor |
| `.session_id` | `str\|None` | Deepsearch session to continue |
| `.waiting_for` | `str` | Deepsearch state |
| `.clarification` | `str\|None` | Follow-up question from the planner |
| `.trace` | `dict\|None` | Planner debugging info |
| `.warnings` | `list[dict]` | Server notices |

| Method | Returns | Description |
|--------|---------|-------------|
| `.get_shots()` | `list[Shot]` | Matching segments |
| `.compile()` | `str` | Stream URL of all shots |
| `.play()` | `str` | Open the compiled stream |

Iterable, sized, and indexable. **Has no `.stream_url`, `.player_url`, or `.collection_id`** — use `.compile()`.

### AskResponse

| Property | Type | Description |
|----------|------|-------------|
| `.answer` | `str` | Synthesised answer |
| `.sources` | `list[Shot]` | Evidence shots when `include_sources=True` |
| `.warnings` | `list[dict]` | Server notices |

### SearchResult

Returned by `semantic_search()`, `query()`, and `legacy_search()`.

| Method | Returns | Description |
|--------|---------|-------------|
| `results.get_shots()` | `list[Shot]` | Get list of matching segments |
| `results.compile()` | `str` | Compile all shots into a stream URL |
| `results.play()` | `str` | Open compiled stream in browser |

### Shot Properties

| Property | Type | Description |
|----------|------|-------------|
| `shot.video_id` | `str` | Source video ID |
| `shot.video_length` | `float` | Source video duration |
| `shot.video_title` | `str` | Source video title |
| `shot.start` | `float` | Start time (seconds) |
| `shot.end` | `float` | End time (seconds) |
| `shot.text` | `str` | Matched text content |
| `shot.search_score` | `float` | Search relevance score |

| Method | Returns | Description |
|--------|---------|-------------|
| `shot.generate_stream()` | `str` | Stream this specific shot |
| `shot.play()` | `str` | Open shot stream in browser |

## Meeting Object

```python
meeting = coll.record_meeting(
    meeting_url="https://meet.google.com/...",
    bot_name="Bot",
    callback_url=None,          # Webhook URL for status updates
    callback_data=None,         # Optional dict passed through to callbacks
    time_zone="UTC",            # Time zone for the meeting
)
```

### Meeting Properties

| Property | Type | Description |
|----------|------|-------------|
| `meeting.id` | `str` | Unique meeting ID |
| `meeting.collection_id` | `str` | Parent collection ID |
| `meeting.status` | `str` | Current status |
| `meeting.video_id` | `str` | Recorded video ID (after completion) |
| `meeting.bot_name` | `str` | Bot name |
| `meeting.meeting_title` | `str` | Meeting title |
| `meeting.meeting_url` | `str` | Meeting URL |
| `meeting.speaker_timeline` | `dict` | Speaker timeline data |
| `meeting.is_active` | `bool` | True if initializing or processing |
| `meeting.is_completed` | `bool` | True if done |

### Meeting Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `meeting.refresh()` | `Meeting` | Refresh data from server |
| `meeting.wait_for_status(target_status, timeout=14400, interval=120)` | `bool` | Poll until status reached |

## RTStream & Capture

For RTStream (live ingestion, indexing, transcription), see [rtstream-reference.md](rtstream-reference.md).

For capture sessions (desktop recording, CaptureClient, channels), see [capture-reference.md](capture-reference.md).

## Enums & Constants

### SearchType

```python
from videodb import SearchType

SearchType.semantic    # Natural language semantic search
SearchType.keyword     # Exact keyword matching
SearchType.scene       # Visual scene search (may require paid plan)
SearchType.llm         # LLM-powered search
```

### SceneExtractionType

```python
from videodb import SceneExtractionType

SceneExtractionType.shot_based   # Automatic shot boundary detection
SceneExtractionType.time_based   # Fixed time interval extraction
SceneExtractionType.transcript   # Transcript-based scene extraction
```

### SubtitleStyle

```python
from videodb import SubtitleStyle

style = SubtitleStyle(
    font_name="Arial",
    font_size=18,
    primary_colour="&H00FFFFFF",
    bold=False,
    # ... see SubtitleStyle for all options
)
video.add_subtitle(style=style)
```

### SubtitleAlignment & SubtitleBorderStyle

```python
from videodb import SubtitleAlignment, SubtitleBorderStyle
```

### TextStyle

```python
from videodb import TextStyle
# or: from videodb.asset import TextStyle

style = TextStyle(
    fontsize=24,
    fontcolor="black",
    boxcolor="white",
    font="Sans",
    text_align="T",
    alpha=1.0,
)
```

### Other Constants

```python
from videodb import (
    IndexCapability,    # semantic, query, aggregate      (v2 use_for)
    FieldGroup,         # semantic, filter, aggregate, sort (v2 fields)
    IndexType,          # spoken_word, scene              (v1 only)
    MediaType,          # video, audio, image
    Segmenter,          # word, sentence, time
    SegmentationType,   # sentence, llm
    TranscodeMode,      # economy, lightning
    ResizeMode,         # crop, fit, pad
    ReframeMode,        # simple, smart
    RTStreamChannelType,
)
```

> `IndexType` was not extended for v2 — v2 indexes are addressed by `name` or `index_id`, not by type. The server also recognises the field groups `fts`, `hydrate`, and `return`, which `FieldGroup` does not name.

## Exceptions

```python
from videodb.exceptions import (
    AuthenticationError,     # Invalid or missing API key
    InvalidRequestError,     # Bad parameters or malformed request
    RequestTimeoutError,     # Request timed out
    SearchError,             # Search operation failure (e.g. not indexed)
    VideodbError,            # Base exception for all VideoDB errors
)
```

| Exception | Common Cause |
|-----------|-------------|
| `AuthenticationError` | Missing or invalid `VIDEO_DB_API_KEY` |
| `InvalidRequestError` | Invalid URL, unsupported format, bad parameters |
| `RequestTimeoutError` | Server took too long to respond |
| `SearchError` | Searching before indexing, invalid search type |
| `VideodbError` | Server errors, network issues, generic failures |
