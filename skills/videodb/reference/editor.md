# Timeline Editing Guide

VideoDB Editor lets you compose videos programmatically using a 4-layer architecture: **Asset → Clip → Track → Timeline**. Build anything from a simple trim to a multi-layer production with images, audio, video, text, and captions — all server-side, no local encoding or ffmpeg needed.

For code-level details (constructors, parameters, enums), see [editor-reference.md](editor-reference.md).

## Contents

- Prerequisites
- The 4-Layer Model (asset, clip, track, timeline)
- What You Can Build
- Workflow
- Key Concepts (double start, z-order, fit modes, volume, transitions, captions)
- Complete Workflow Examples
- Limitations
- Tips
- Gotchas

## Prerequisites

All media **must be uploaded** to a collection before it can be used as an asset. For auto-generated captions, the source video must also have a **transcript**: `video.generate_transcript()`, or a `spoken_words` analyzer run.

```python
import videodb

conn = videodb.connect()
coll = conn.get_collection()
```

---

## The 4-Layer Model

### Asset — What to show

An asset is a reference to media in your collection. It doesn't define timing, size, or effects — just what content to use and optionally where to start in the source.

Five asset types: `VideoAsset`, `ImageAsset`, `AudioAsset`, `TextAsset`, `CaptionAsset`.

### Clip — How to show it

A clip wraps an asset and controls presentation: how long it plays (`duration`), how it fits the frame (`fit`), where it sits (`position`), transparency (`opacity`), size (`scale`), visual effects (`filter`), and fade transitions (`transition`).

Every clip needs an asset and a duration. Everything else is optional.

### Track — When and where on the timeline

A track is a lane that holds clips at specific second marks. Clips on the **same track** play sequentially. Clips on **different tracks** at the same timestamp play simultaneously (layered).

### Timeline — The final canvas

The timeline defines the output: resolution, background color, and the stack of tracks. Call `generate_stream()` to render it into a playable HLS URL.

---

## What You Can Build

- **Image slideshows with voiceover** — Generate images and voice from text, sequence them as slides with narration audio on a separate track. No source video needed.
- **Multi-track video with background music** — Put your video on one track, music on another at reduced volume, logo on a third.
- **Branded content** — Text overlays, custom resolution, fade transitions, watermarks with opacity control.
- **Captioned videos** — Auto-generated subtitles synced to speech, with animation styles like `box_highlight`, `reveal`, `karaoke`.
- **Compilations and montages** — Trim segments from multiple videos, sequence them with transitions.
- **Vertical / social media formats** — Set resolution to `608x1080` for TikTok/Reels/Shorts, `1080x1080` for square.
- **Append an outro or music video** — Place a video or song at the end of your composition.

---

## Workflow

### 1. Upload or generate your assets

Upload media from files, URLs, or YouTube. Or generate them with AI:

```python
image = coll.generate_image(prompt="sunset over mountains", aspect_ratio="16:9")
voice = coll.generate_voice(text="Welcome to the show", voice_name="Default")
music = coll.generate_music(prompt="chill lo-fi background", duration=30)
video = coll.upload(url="https://www.youtube.com/watch?v=VIDEO_ID")
```

See [generative.md](generative.md) for all generation methods.

### 2. Wrap assets in clips

Set how long each asset shows, how it fits the frame, and optional transitions:

```python
from videodb.editor import Clip, ImageAsset, AudioAsset, Fit, Transition

image_clip = Clip(
    asset=ImageAsset(id=image.id),
    duration=10,
    fit=Fit.crop,
    transition=Transition(in_="fade", out="fade", duration=0.5),
)

voice_clip = Clip(
    asset=AudioAsset(id=voice.id, volume=1.0),
    duration=voice.length,
)
```

### 3. Place clips on tracks

Create tracks and add clips at specific second marks:

```python
from videodb.editor import Track

image_track = Track()
image_track.add_clip(0, image_clip)

voice_track = Track()
voice_track.add_clip(0, voice_clip)
```

Clips on the same track at different start times play one after another. Clips on different tracks at the same start time play simultaneously.

### 4. Build the timeline

Set your canvas resolution and background, add tracks, and render:

```python
from videodb.editor import Timeline

timeline = Timeline(conn)
timeline.resolution = "1280x720"
timeline.background = "#000000"

timeline.add_track(image_track)
timeline.add_track(voice_track)

stream_url = timeline.generate_stream()
print(f"Stream: {stream_url}")
print(f"Player: {timeline.player_url}")
```

---

## Key Concepts

### The "double start"

There are two independent start parameters:

- **Asset start** (`VideoAsset(start=30)`) — trims the source file. Skips the first 30 seconds of the original media.
- **Track start** (`track.add_clip(5, clip)`) — positions the clip on the output timeline. It will appear at the 5-second mark.

These are independent. You can extract any segment from source media and place it anywhere on the timeline.

### Z-order (layering)

Tracks added later render on top of earlier ones:

```python
timeline.add_track(background_track)  # bottom layer
timeline.add_track(overlay_track)     # renders above background
timeline.add_track(audio_track)       # audio tracks mix together
```

For visual tracks, later ones overlay earlier ones. For audio tracks, they mix (play simultaneously).

### Fit modes

When your asset's aspect ratio doesn't match the timeline's resolution:

- **crop** (default) — fills the frame completely, crops edges if needed. Best when filling the frame is priority.
- **contain** — fits the entire asset inside the frame, adds letterbox bars if needed. Best when showing all content matters.
- **cover** — stretches to fill the frame without maintaining aspect ratio. Can distort.
- **none** — uses the asset's native pixel dimensions. No scaling.

### Volume control

`VideoAsset` and `AudioAsset` both accept a `volume` parameter:

- `1.0` = original volume (default)
- `0.2` = 20% volume (good for background music)
- `0.0` = muted

This lets you mix a voiceover at full volume with background music at low volume on separate tracks.

### Transitions

Clips can fade in and out smoothly instead of hard-cutting:

```python
Transition(in_="fade", out="fade", duration=0.5)
```

The `in_` parameter uses an underscore because `in` is a Python keyword.

### Resolution

Format is `"WIDTHxHEIGHT"` as a string. Common presets:

- `"1280x720"` — 16:9 landscape (YouTube, default)
- `"1920x1080"` — Full HD landscape
- `"1080x1080"` — 1:1 square (Instagram feed)
- `"608x1080"` — 9:16 vertical (TikTok, Shorts, Reels)

### Filters

Apply visual effects to individual clips:

`greyscale`, `blur`, `boost`, `contrast`, `darken`, `lighten`, `muted`, `negative`

```python
from videodb.editor import Filter

clip = Clip(asset=video_asset, duration=10, filter=Filter.greyscale)
```

### Captions

Auto-generate subtitles synced to speech with animation effects. The video must have a transcript first:

```python
video.generate_transcript()
```

Caption animations: `box_highlight`, `color_highlight`, `reveal`, `karaoke`, `impact`, `supersize`.

Caption colors use ASS format: `&HAABBGGRR` in hex (e.g., `&H00FFFFFF` = white).

---

## Complete Workflow Examples

### Image slideshow with narration

Generate images and voice, compose a narrated slideshow:

```python
from videodb.editor import Timeline, Track, Clip, ImageAsset, AudioAsset, Fit, Transition

chunks = [
    {"text": "Our journey begins at dawn.", "image_prompt": "sunrise over mountains, digital art"},
    {"text": "We crossed rivers and forests.", "image_prompt": "river through a dense forest, illustrated"},
    {"text": "And arrived at the summit.", "image_prompt": "mountain summit view, dramatic lighting"},
]

assets = []
for chunk in chunks:
    img = coll.generate_image(prompt=chunk["image_prompt"], aspect_ratio="16:9")
    voice = coll.generate_voice(text=chunk["text"])
    assets.append({"image": img, "voice": voice, "duration": voice.length})

timeline = Timeline(conn)
timeline.resolution = "1280x720"
timeline.background = "#000000"

image_track = Track()
voice_track = Track()
current = 0.0

for a in assets:
    image_track.add_clip(current, Clip(
        asset=ImageAsset(id=a["image"].id),
        duration=a["duration"],
        fit=Fit.crop,
        transition=Transition(in_="fade", out="fade", duration=0.5),
    ))
    voice_track.add_clip(current, Clip(
        asset=AudioAsset(id=a["voice"].id, volume=1.0),
        duration=a["duration"],
    ))
    current += a["duration"]

timeline.add_track(image_track)
timeline.add_track(voice_track)

stream_url = timeline.generate_stream()
```

### Video with background music at low volume

```python
from videodb.editor import Timeline, Track, Clip, VideoAsset, AudioAsset

timeline = Timeline(conn)
timeline.resolution = "1280x720"

video_track = Track()
video_track.add_clip(0, Clip(
    asset=VideoAsset(id=video.id, volume=1.0),
    duration=video.length,
))

music_track = Track()
music_track.add_clip(0, Clip(
    asset=AudioAsset(id=music.id, volume=0.2),
    duration=video.length,
))

timeline.add_track(video_track)
timeline.add_track(music_track)

stream_url = timeline.generate_stream()
```

### Video with styled captions

```python
from videodb.editor import (
    Timeline, Track, Clip, VideoAsset,
    CaptionAsset, FontStyling, BorderAndShadow, Positioning, CaptionAnimation,
)

video.generate_transcript()

caption = CaptionAsset(
    src="auto",
    font=FontStyling(name="Clear Sans", size=30),
    primary_color="&H00FFFFFF",
    back_color="&H00000000",
    border=BorderAndShadow(outline=1),
    position=Positioning(margin_v=30),
    animation=CaptionAnimation.box_highlight,
)

timeline = Timeline(conn)
timeline.resolution = "1280x720"

video_track = Track()
video_track.add_clip(0, Clip(asset=VideoAsset(id=video.id), duration=video.length))

caption_track = Track()
caption_track.add_clip(0, Clip(asset=caption, duration=video.length))

timeline.add_track(video_track)
timeline.add_track(caption_track)

stream_url = timeline.generate_stream()
```

### Append a YouTube video as outro

```python
from videodb.editor import Timeline, Track, Clip, VideoAsset, ImageAsset, AudioAsset

main_end = 60.0
outro_video = coll.upload(url="https://www.youtube.com/watch?v=VIDEO_ID")

timeline = Timeline(conn)
timeline.resolution = "1280x720"

main_track = Track()
# ... add your main content clips to main_track ...

outro_track = Track()
outro_track.add_clip(main_end, Clip(
    asset=VideoAsset(id=outro_video.id, volume=1.0),
    duration=min(outro_video.length, 60.0),
))

timeline.add_track(main_track)
timeline.add_track(outro_track)

stream_url = timeline.generate_stream()
```

---

## Limitations

The editor handles composition, not visual effects processing. These operations are not supported:

- **No speed or playback control** — no slow-motion, fast-forward, or reverse
- **No region crop, zoom, or pan** — `Crop` trims edges, it doesn't extract a region. Use `video.reframe()` for aspect-ratio conversion instead.
- **No keyframe animation** — clip properties are static for the clip's duration
- **No video-on-video picture-in-picture** — use `scale` + `position` on a smaller clip to approximate

---

## Tips

- **Non-destructive**: timelines never modify source media. Create multiple timelines from the same assets.
- **Generated media works immediately**: output from `generate_image()`, `generate_voice()`, `generate_music()`, `generate_sound_effect()` can be used as assets right away.
- **Stream URLs are instant**: `generate_stream()` returns a playable HLS URL with no render wait.
- **Player URL**: after `generate_stream()`, `timeline.player_url` gives a web player link: `https://console.videodb.io/player?url={STREAM_URL}`
- **Download**: use `timeline.download_stream(stream_url)` to download the rendered video.
- **Large timelines**: if the timeline JSON exceeds 100KB, the SDK automatically uploads it as a file before rendering.
- **Supported fonts**: Clear Sans (default), Noto Sans Devanagari, Noto Sans Gurmukhi, Noto Sans Gujarati, Noto Sans Kannada.

## Gotchas

- **Clip duration must not exceed asset length**: `Clip(duration=X)` where X > the source asset's `.length` causes `Clip duration: X greater than video/audio length: Y`. Always store and check exact lengths after generation. Use `math.floor(length * 100) / 100` — never `round()`, which can round up past the actual length.
- **`.length` may return a string**: Voice, audio, and video objects can return `.length` as a string. Always cast with `float(asset.length)` before doing arithmetic.
- **`track.add_clip()` start is an integer**: The `start` parameter is in whole seconds. Plan segment boundaries at whole-second marks — sub-second precision is lost.
