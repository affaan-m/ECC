# Timeline Editing Guide

VideoDB provides a non-destructive timeline editor for composing videos from multiple assets, adding text and image overlays, mixing audio tracks, and trimming clips — all server-side without re-encoding or local tools. Use this for trimming, combining clips, overlaying audio/music on video, adding subtitles, and layering text or images.

## Prerequisites

Videos, audio, and images **must be uploaded** to a collection before they can be used as timeline assets. For caption overlays, the video must also be **indexed for spoken words**.

## Core Concepts

### Timeline

A `Timeline` is a virtual composition layer. Assets are placed on it either **inline** (sequentially on the main track) or as **overlays** (layered at a specific timestamp). Nothing modifies the original media; the final stream is compiled on demand.

```python
from videodb.timeline import Timeline

timeline = Timeline(conn)
```

### Assets

Every element on a timeline is an **asset**. VideoDB provides five asset types:

| Asset | Import | Primary Use |
|-------|--------|-------------|
| `VideoAsset` | `from videodb.asset import VideoAsset` | Video clips (trim, sequencing) |
| `AudioAsset` | `from videodb.asset import AudioAsset` | Music, SFX, narration |
| `ImageAsset` | `from videodb.asset import ImageAsset` | Logos, thumbnails, overlays |
| `TextAsset` | `from videodb.asset import TextAsset, TextStyle` | Titles, captions, lower-thirds |
| `CaptionAsset` | `from videodb.editor import CaptionAsset` | Auto-rendered subtitles (Editor API) |

## Building a Timeline

### Add Video Clips Inline

Inline assets play one after another on the main video track. The `add_inline` method only accepts `VideoAsset`:

```python
from videodb.asset import VideoAsset

video_a = coll.get_video(video_id_a)
video_b = coll.get_video(video_id_b)

timeline = Timeline(conn)
timeline.add_inline(VideoAsset(asset_id=video_a.id))
timeline.add_inline(VideoAsset(asset_id=video_b.id))

stream_url = timeline.generate_stream()
```

### Trim / Sub-clip

Use `start` and `end` on a `VideoAsset` to extract a portion:

```python
# Take only seconds 10–30 from the source video
clip = VideoAsset(asset_id=video.id, start=10, end=30)
timeline.add_inline(clip)
```

### VideoAsset Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `asset_id` | `str` | required | Video media ID |
| `start` | `float` | `0` | Trim start (seconds) |
| `end` | `float\|None` | `None` | Trim end (`None` = full) |

> **Warning:** The SDK does not validate negative timestamps. Passing `start=-5` is silently accepted but produces broken or unexpected output. Always ensure `start >= 0`, `start < end`, and `end <= video.length` before creating a `VideoAsset`.

## Text Overlays

Add titles, lower-thirds, or captions at any point on the timeline:

```python
from videodb.asset import TextAsset, TextStyle

title = TextAsset(
    text="Welcome to the Demo",
    duration=5,
    style=TextStyle(
        fontsize=36,
        fontcolor="white",
        boxcolor="black",
        alpha=0.8,
        font="Sans",
    ),
)

# Overlay the title at the very start (t=0)
timeline.add_overlay(0, title)
```

### TextStyle Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `fontsize` | `int` | `24` | Font size in pixels |
| `fontcolor` | `str` | `"black"` | CSS colour name or hex |
| `fontcolor_expr` | `str` | `""` | Dynamic font colour expression |
| `alpha` | `float` | `1.0` | Text opacity (0.0–1.0) |
| `font` | `str` | `"Sans"` | Font family |
| `box` | `bool` | `True` | Enable background box |
| `boxcolor` | `str` | `"white"` | Background box colour |
| `boxborderw` | `str` | `"10"` | Box border width |
| `boxw` | `int` | `0` | Box width override |
| `boxh` | `int` | `0` | Box height override |
| `line_spacing` | `int` | `0` | Line spacing |
| `text_align` | `str` | `"T"` | Text alignment within the box |
| `y_align` | `str` | `"text"` | Vertical alignment reference |
| `borderw` | `int` | `0` | Text border width |
| `bordercolor` | `str` | `"black"` | Text border colour |
| `expansion` | `str` | `"normal"` | Text expansion mode |
| `basetime` | `int` | `0` | Base time for time-based expressions |
| `fix_bounds` | `bool` | `False` | Fix text bounds |
| `text_shaping` | `bool` | `True` | Enable text shaping |
| `shadowcolor` | `str` | `"black"` | Shadow colour |
| `shadowx` | `int` | `0` | Shadow X offset |
| `shadowy` | `int` | `0` | Shadow Y offset |
| `tabsize` | `int` | `4` | Tab size in spaces |
| `x` | `str` | `"(main_w-text_w)/2"` | Horizontal position expression |
| `y` | `str` | `"(main_h-text_h)/2"` | Vertical position expression |

## Audio Overlays

Layer background music, sound effects, or voiceover on top of the video track:

```python
from videodb.asset import AudioAsset

music = coll.get_audio(music_id)

audio_layer = AudioAsset(
    asset_id=music.id,
    disable_other_tracks=False,
    fade_in_duration=2,
    fade_out_duration=2,
)

# Start the music at t=0, overlaid on the video track
timeline.add_overlay(0, audio_layer)
```

### AudioAsset Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `asset_id` | `str` | required | Audio media ID |
| `start` | `float` | `0` | Trim start (seconds) |
| `end` | `float\|None` | `None` | Trim end (`None` = full) |
| `disable_other_tracks` | `bool` | `True` | When True, mutes other audio tracks |
| `fade_in_duration` | `float` | `0` | Fade-in seconds (max 5) |
| `fade_out_duration` | `float` | `0` | Fade-out seconds (max 5) |

## Image Overlays

Add logos, watermarks, or generated images as overlays:

```python
from videodb.asset import ImageAsset

logo = coll.get_image(logo_id)

logo_overlay = ImageAsset(
    asset_id=logo.id,
    duration=10,
    width=120,
    height=60,
    x=20,
    y=20,
)

timeline.add_overlay(0, logo_overlay)
```

### ImageAsset Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `asset_id` | `str` | required | Image media ID |
| `width` | `int\|str` | `100` | Display width |
| `height` | `int\|str` | `100` | Display height |
| `x` | `int` | `80` | Horizontal position (px from left) |
| `y` | `int` | `20` | Vertical position (px from top) |
| `duration` | `float\|None` | `None` | Display duration (seconds) |

## Caption Overlays

There are two ways to add captions to video.

### Method 1: Subtitle Workflow (simplest)

Use `video.add_subtitle()` to burn subtitles directly onto a video stream. This uses the `videodb.timeline.Timeline` internally:

```python
from videodb import SubtitleStyle

# Video must have spoken words indexed first (force=True skips if already done)
video.index_spoken_words(force=True)

# Add subtitles with default styling
stream_url = video.add_subtitle()

# Or customise the subtitle style
stream_url = video.add_subtitle(style=SubtitleStyle(
    font_name="Arial",
    font_size=22,
    primary_colour="&H00FFFFFF",
    bold=True,
))
```

### Method 2: Editor API (advanced)

The Editor API (`videodb.editor`) provides a track-based composition system with `CaptionAsset`, `Clip`, `Track`, and its own `Timeline`. This is a separate API from the `videodb.timeline.Timeline` used above.

```python
from videodb.editor import (
    CaptionAsset,
    Clip,
    Track,
    Timeline as EditorTimeline,
    FontStyling,
    BorderAndShadow,
    Positioning,
    CaptionAnimation,
)

# Video must have spoken words indexed first (force=True skips if already done)
video.index_spoken_words(force=True)

# Create a caption asset
caption = CaptionAsset(
    src="auto",
    font=FontStyling(name="Clear Sans", size=30),
    primary_color="&H00FFFFFF",
    back_color="&H00000000",
    border=BorderAndShadow(outline=1),
    position=Positioning(margin_v=30),
    animation=CaptionAnimation.box_highlight,
)

# Build an editor timeline with tracks and clips
editor_tl = EditorTimeline(conn)
track = Track()
track.add_clip(start=0, clip=Clip(asset=caption, duration=video.length))
editor_tl.add_track(track)
stream_url = editor_tl.generate_stream()
```

### CaptionAsset Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `src` | `str` | `"auto"` | Caption source (`"auto"` or base64 ASS string) |
| `font` | `FontStyling\|None` | `FontStyling()` | Font styling (name, size, bold, italic, etc.) |
| `primary_color` | `str` | `"&H00FFFFFF"` | Primary text colour (ASS format) |
| `secondary_color` | `str` | `"&H000000FF"` | Secondary text colour (ASS format) |
| `back_color` | `str` | `"&H00000000"` | Background colour (ASS format) |
| `border` | `BorderAndShadow\|None` | `BorderAndShadow()` | Border and shadow styling |
| `position` | `Positioning\|None` | `Positioning()` | Caption alignment and margins |
| `animation` | `CaptionAnimation\|None` | `None` | Animation effect (e.g., `box_highlight`, `reveal`, `karaoke`) |

## Compiling & Streaming

After assembling a timeline, compile it into a streamable URL. Streams are generated instantly - no render wait times.

```python
stream_url = timeline.generate_stream()
print(f"Stream: {stream_url}")
```

For more streaming options (segment streams, search-to-stream, audio playback), see [streaming.md](streaming.md).

## Complete Workflow Examples

### Highlight Reel with Title Card

```python
import videodb
from videodb import SearchType
from videodb.exceptions import InvalidRequestError
from videodb.timeline import Timeline
from videodb.asset import VideoAsset, TextAsset, TextStyle

conn = videodb.connect()
coll = conn.get_collection()
video = coll.get_video("your-video-id")

# 1. Search for key moments
video.index_spoken_words(force=True)
try:
    results = video.search("product announcement", search_type=SearchType.semantic)
    shots = results.get_shots()
except InvalidRequestError as exc:
    if "No results found" in str(exc):
        shots = []
    else:
        raise

# 2. Build timeline
timeline = Timeline(conn)

# Title card
title = TextAsset(
    text="Product Launch Highlights",
    duration=4,
    style=TextStyle(fontsize=48, fontcolor="white", boxcolor="#1a1a2e", alpha=0.95),
)
timeline.add_overlay(0, title)

# Append each matching clip
for shot in shots:
    asset = VideoAsset(asset_id=shot.video_id, start=shot.start, end=shot.end)
    timeline.add_inline(asset)

# 3. Generate stream
stream_url = timeline.generate_stream()
print(f"Highlight reel: {stream_url}")
```

### Logo Overlay with Background Music

```python
import videodb
from videodb.timeline import Timeline
from videodb.asset import VideoAsset, AudioAsset, ImageAsset

conn = videodb.connect()
coll = conn.get_collection()

main_video = coll.get_video(main_video_id)
music = coll.get_audio(music_id)
logo = coll.get_image(logo_id)

timeline = Timeline(conn)

# Main video track
timeline.add_inline(VideoAsset(asset_id=main_video.id))

# Background music — disable_other_tracks=False to mix with video audio
timeline.add_overlay(
    0,
    AudioAsset(asset_id=music.id, disable_other_tracks=False, fade_in_duration=3),
)

# Logo in top-right corner for first 10 seconds
timeline.add_overlay(
    0,
    ImageAsset(asset_id=logo.id, duration=10, x=1140, y=20, width=120, height=60),
)

stream_url = timeline.generate_stream()
print(f"Final video: {stream_url}")
```

### Multi-Clip Montage from Multiple Videos

```python
import videodb
from videodb.timeline import Timeline
from videodb.asset import VideoAsset, TextAsset, TextStyle

conn = videodb.connect()
coll = conn.get_collection()

clips = [
    {"video_id": "vid_001", "start": 5, "end": 15, "label": "Scene 1"},
    {"video_id": "vid_002", "start": 0, "end": 20, "label": "Scene 2"},
    {"video_id": "vid_003", "start": 30, "end": 45, "label": "Scene 3"},
]

timeline = Timeline(conn)
timeline_offset = 0.0

for clip in clips:
    # Add a label as an overlay on each clip
    label = TextAsset(
        text=clip["label"],
        duration=2,
        style=TextStyle(fontsize=32, fontcolor="white", boxcolor="#333333"),
    )
    timeline.add_inline(
        VideoAsset(asset_id=clip["video_id"], start=clip["start"], end=clip["end"])
    )
    timeline.add_overlay(timeline_offset, label)
    timeline_offset += clip["end"] - clip["start"]

stream_url = timeline.generate_stream()
print(f"Montage: {stream_url}")
```

## Two Timeline APIs

VideoDB has two separate timeline systems. They are **not interchangeable**:

| | `videodb.timeline.Timeline` | `videodb.editor.Timeline` (Editor API) |
|---|---|---|
| **Import** | `from videodb.timeline import Timeline` | `from videodb.editor import Timeline as EditorTimeline` |
| **Assets** | `VideoAsset`, `AudioAsset`, `ImageAsset`, `TextAsset` | `CaptionAsset`, `Clip`, `Track` |
| **Methods** | `add_inline()`, `add_overlay()` | `add_track()` with `Track` / `Clip` |
| **Best for** | Video composition, overlays, multi-clip editing | Caption/subtitle styling with animations |

Do not mix assets from one API into the other. `CaptionAsset` only works with the Editor API. `VideoAsset` / `AudioAsset` / `ImageAsset` / `TextAsset` only work with `videodb.timeline.Timeline`.

## Limitations & Constraints

The timeline editor is designed for **non-destructive linear composition**. The following operations are **not supported**:

### Not Possible

| Limitation | Detail |
|---|---|
| **No transitions or effects** | No crossfades, wipes, dissolves, or transitions between clips. All cuts are hard cuts. |
| **No video-on-video (picture-in-picture)** | `add_inline()` only accepts `VideoAsset`. You cannot overlay one video stream on top of another. Image overlays can approximate static PiP but not live video. |
| **No speed or playback control** | No slow-motion, fast-forward, reverse playback, or time remapping. `VideoAsset` has no `speed` parameter. |
| **No crop, zoom, or pan** | Cannot crop a region of a video frame, apply zoom effects, or pan across a frame. `video.reframe()` is for aspect-ratio conversion only. |
| **No video filters or color grading** | No brightness, contrast, saturation, hue, or color correction adjustments. |
| **No animated text** | `TextAsset` is static for its full duration. No fade-in/out, movement, or animation. For animated captions, use `CaptionAsset` with the Editor API. |
| **No mixed text styling** | A single `TextAsset` has one `TextStyle`. Cannot mix bold, italic, or colors within a single text block. |
| **No blank or solid-color clips** | Cannot create a solid color frame, black screen, or standalone title card. Text and image overlays require a `VideoAsset` beneath them on the inline track. |
| **No audio volume control** | `AudioAsset` has no `volume` parameter. Audio is either full volume or muted via `disable_other_tracks`. Cannot mix at a reduced level. |
| **No keyframe animation** | Cannot change overlay properties over time (e.g., move an image from position A to B). |

### Constraints

| Constraint | Detail |
|---|---|
| **Audio fade max 5 seconds** | `fade_in_duration` and `fade_out_duration` are capped at 5 seconds each. |
| **Overlay positioning is absolute** | Overlays use absolute timestamps from the timeline start. Rearranging inline clips does not move their overlays. |
| **Inline track is video only** | `add_inline()` only accepts `VideoAsset`. Audio, image, and text must use `add_overlay()`. |
| **No overlay-to-clip binding** | Overlays are placed at a fixed timeline timestamp. There is no way to attach an overlay to a specific inline clip so it moves with it. |

## Tips

- **Non-destructive**: Timelines never modify source media. You can create multiple timelines from the same assets.
- **Overlay stacking**: Multiple overlays can start at the same timestamp. Audio overlays mix together; image/text overlays layer in add-order.
- **Inline is VideoAsset only**: `add_inline()` only accepts `VideoAsset`. Use `add_overlay()` for `AudioAsset`, `ImageAsset`, and `TextAsset`.
- **Trim precision**: `start`/`end` on `VideoAsset` and `AudioAsset` are in seconds.
- **Muting video audio**: Set `disable_other_tracks=True` on `AudioAsset` to mute the original video audio when overlaying music or narration.
- **Fade limits**: `fade_in_duration` and `fade_out_duration` on `AudioAsset` have a maximum of 5 seconds.
- **Generated media**: Use `coll.generate_music()`, `coll.generate_sound_effect()`, `coll.generate_voice()`, and `coll.generate_image()` to create media that can be used as timeline assets immediately.
