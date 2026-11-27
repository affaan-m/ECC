# Complete API Reference

Reference material for the VideoDB skill. For usage guidance and workflow selection, start with [../SKILL.md](../SKILL.md).

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
| `coll.search(query, search_type, index_type, score_threshold, namespace, scene_index_id, ...)` | `SearchResult` | Search across collection (semantic only; keyword and scene search raise `NotImplementedError`) |
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
| `video.index_spoken_words(language_code=None, force=False)` | `None` | Index speech for search. Use `force=True` to skip if already indexed. |
| `video.index_scenes(extraction_type, prompt, extraction_config, metadata, model_name, name, scenes, callback_url)` | `str` | Index visual scenes (returns scene_index_id) |
| `video.index_visuals(prompt, batch_config, ...)` | `str` | Index visuals (returns scene_index_id) |
| `video.index_audio(prompt, model_name, ...)` | `str` | Index audio with LLM (returns scene_index_id) |
| `video.get_transcript(start=None, end=None)` | `list[dict]` | Get timestamped transcript |
| `video.get_transcript_text(start=None, end=None)` | `str` | Get full transcript text |
| `video.generate_transcript(force=None)` | `dict` | Generate transcript |
| `video.translate_transcript(language, additional_notes)` | `list[dict]` | Translate transcript |
| `video.search(query, search_type, index_type, filter, **kwargs)` | `SearchResult` | Search within video |
| `video.add_subtitle(style=SubtitleStyle())` | `str` | Add subtitles (returns stream URL) |
| `video.generate_thumbnail(time=None)` | `str\|Image` | Generate thumbnail |
| `video.get_thumbnails()` | `list[Image]` | Get all thumbnails |
| `video.extract_scenes(extraction_type, extraction_config)` | `SceneCollection` | Extract scenes |
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

```python
results = video.search(
    query="your query",
    search_type=SearchType.semantic,       # semantic, keyword, or scene
    index_type=IndexType.spoken_word,      # spoken_word or scene
    result_threshold=None,                 # max number of results
    score_threshold=None,                  # minimum relevance score
    dynamic_score_percentage=None,         # percentage of dynamic score
    scene_index_id=None,                   # target a specific scene index (pass via **kwargs)
    filter=[],                             # metadata filters for scene search
)
```

> **Note:** `filter` is an explicit named parameter in `video.search()`. `scene_index_id` is passed through `**kwargs` to the API.
>
> **Important:** `video.search()` raises `InvalidRequestError` with message `"No results found"` when there are no matches. Always wrap search calls in try/except. For scene search, use `score_threshold=0.3` or higher to filter low-relevance noise.

For scene search, use `search_type=SearchType.semantic` with `index_type=IndexType.scene`. Pass `scene_index_id` when targeting a specific scene index. See [search.md](search.md) for details.

## SearchResult Object

```python
results = video.search("query", search_type=SearchType.semantic)
```

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
    IndexType,          # spoken_word, scene
    MediaType,          # video, audio, image
    Segmenter,          # word, sentence, time
    SegmentationType,   # sentence, llm
    TranscodeMode,      # economy, lightning
    ResizeMode,         # crop, fit, pad
    ReframeMode,        # simple, smart
    RTStreamChannelType,
)
```

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
