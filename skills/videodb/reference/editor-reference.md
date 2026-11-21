# Editor Reference

Code-level details for VideoDB's timeline editor. For workflow guide, see [editor.md](editor.md).

---

## Contents

- Imports
- Assets (Video, Image, Audio, Text, Caption)
- Clip
- Track
- Timeline
- Enums (Fit, Position, Filter, CaptionAnimation, alignment)
- Helper Classes (Transition, Offset, Crop, Font, Border, Shadow)
- Supported Fonts
- Complete Examples

## Imports

```python
from videodb.editor import (
    Timeline, Track, Clip,
    VideoAsset, ImageAsset, AudioAsset, TextAsset, CaptionAsset,
    Fit, Position, Offset, Crop, Filter, Transition,
    Font, Border, Shadow, Background, Alignment,
    FontStyling, BorderAndShadow, Positioning,
    TextAlignment, HorizontalAlignment, VerticalAlignment,
    CaptionAlignment, CaptionBorderStyle, CaptionAnimation,
)
```

---

## Assets

### VideoAsset

```python
VideoAsset(id: str, start: int = 0, volume: float = 1, crop: Optional[Crop] = None)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `id` | `str` | required | VideoDB media ID |
| `start` | `int` | `0` | Trim start in seconds (skip first N seconds of source) |
| `volume` | `float` | `1` | Audio volume level, 0 to 5 |
| `crop` | `Crop\|None` | `None` | Edge crop (scale 0–1 per side) |

Validates: `start >= 0`, `0 <= volume <= 5`.

### ImageAsset

```python
ImageAsset(id: str, crop: Optional[Crop] = None)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `id` | `str` | required | VideoDB image ID |
| `crop` | `Crop\|None` | `None` | Edge crop (scale 0–1 per side) |

Duration is controlled at the Clip layer, not on the asset.

### AudioAsset

```python
AudioAsset(id: str, start: int = 0, volume: float = 1)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `id` | `str` | required | VideoDB audio ID |
| `start` | `int` | `0` | Trim start in seconds |
| `volume` | `float` | `1` | Volume level (0 = muted, 1 = normal, 0.2 = background level) |

### TextAsset

```python
TextAsset(
    text: str,
    font: Optional[Font] = None,
    border: Optional[Border] = None,
    shadow: Optional[Shadow] = None,
    background: Optional[Background] = None,
    alignment: Optional[Alignment] = None,
    tabsize: int = 4,
    line_spacing: float = 0,
    width: Optional[int] = None,
    height: Optional[int] = None,
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `text` | `str` | required | Text content to display |
| `font` | `Font\|None` | `Font()` | Font styling |
| `border` | `Border\|None` | `None` | Text border |
| `shadow` | `Shadow\|None` | `None` | Text shadow |
| `background` | `Background\|None` | `None` | Background box behind text |
| `alignment` | `Alignment\|None` | `Alignment()` | Text alignment within box |
| `tabsize` | `int` | `4` | Tab character width in spaces |
| `line_spacing` | `float` | `0` | Spacing between lines |
| `width` | `int\|None` | `None` | Text box width in pixels |
| `height` | `int\|None` | `None` | Text box height in pixels |

### CaptionAsset

```python
CaptionAsset(
    src: str = "auto",
    font: Optional[FontStyling] = None,
    primary_color: str = "&H00FFFFFF",
    secondary_color: str = "&H000000FF",
    back_color: str = "&H00000000",
    border: Optional[BorderAndShadow] = None,
    position: Optional[Positioning] = None,
    animation: Optional[CaptionAnimation] = None,
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `src` | `str` | `"auto"` | `"auto"` for speech-synced or base64-encoded ASS string |
| `font` | `FontStyling\|None` | `FontStyling()` | Caption font styling |
| `primary_color` | `str` | `"&H00FFFFFF"` | Primary text color (ASS `&HAABBGGRR` format) |
| `secondary_color` | `str` | `"&H000000FF"` | Secondary color |
| `back_color` | `str` | `"&H00000000"` | Background color |
| `border` | `BorderAndShadow\|None` | `BorderAndShadow()` | Border and shadow styling |
| `position` | `Positioning\|None` | `Positioning()` | Alignment and margins |
| `animation` | `CaptionAnimation\|None` | `None` | Animation effect |

Requires a transcript (`video.generate_transcript()`) before using `src="auto"`.

---

## Clip

```python
Clip(
    asset: AnyAsset,
    duration: Union[float, int],
    transition: Optional[Transition] = None,
    effect: Optional[str] = None,
    filter: Optional[Filter] = None,
    scale: float = 1,
    opacity: float = 1,
    fit: Optional[Fit] = Fit.crop,
    position: Position = Position.center,
    offset: Optional[Offset] = None,
    z_index: int = 0,
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `asset` | `AnyAsset` | required | `VideoAsset`, `ImageAsset`, `AudioAsset`, `TextAsset`, or `CaptionAsset` |
| `duration` | `float\|int` | required | Clip length in seconds |
| `fit` | `Fit\|None` | `Fit.crop` | Scaling mode |
| `position` | `Position` | `Position.center` | Anchor point (9-zone grid) |
| `offset` | `Offset\|None` | `Offset(0, 0)` | Fine-tune position |
| `scale` | `float` | `1` | Size multiplier, 0 to 10 |
| `opacity` | `float` | `1` | Transparency, 0 (invisible) to 1 (opaque) |
| `filter` | `Filter\|None` | `None` | Visual effect |
| `transition` | `Transition\|None` | `None` | Fade in/out |
| `z_index` | `int` | `0` | Layering order within track |

Validates: `0 <= scale <= 10`, `0 <= opacity <= 1`.

---

## Track

```python
Track(z_index: int = 0)
```

| Method | Parameters | Description |
|--------|-----------|-------------|
| `add_clip(start, clip)` | `start: int` — timeline position in seconds, `clip: Clip` | Place a clip at a specific time on this track |

Clips on the same track play sequentially. Use multiple tracks for simultaneous playback.

---

## Timeline

```python
Timeline(connection)
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `background` | `str` | `"#000000"` | Background color (hex) |
| `resolution` | `str` | `"1280x720"` | Output resolution (`"WIDTHxHEIGHT"`) |
| `stream_url` | `str\|None` | `None` | Populated after `generate_stream()` |
| `player_url` | `str\|None` | `None` | Console player URL, populated after `generate_stream()` |

| Method | Returns | Description |
|--------|---------|-------------|
| `add_track(track)` | `None` | Add a track. Later tracks render on top. |
| `generate_stream()` | `str` | Render and return HLS stream URL |
| `download_stream(stream_url)` | `dict` | Download a rendered stream |

---

## Enums

### Fit

How the asset scales to fill the timeline canvas.

| Value | Description |
|-------|-------------|
| `Fit.crop` | Fill canvas, crop edges if aspect ratios differ (default) |
| `Fit.contain` | Fit inside canvas, letterbox bars if needed |
| `Fit.cover` | Stretch to fill, may distort |
| `Fit.none` | Native pixel dimensions, no scaling |

### Position

9-zone anchor grid for placing clips.

| Value | Position |
|-------|----------|
| `Position.top_left` | Top-left corner |
| `Position.top` | Top center |
| `Position.top_right` | Top-right corner |
| `Position.left` | Center-left |
| `Position.center` | Center (default) |
| `Position.right` | Center-right |
| `Position.bottom_left` | Bottom-left corner |
| `Position.bottom` | Bottom center |
| `Position.bottom_right` | Bottom-right corner |

### Filter

Visual effects applied to the entire clip.

| Value | Effect |
|-------|--------|
| `Filter.greyscale` | Black and white |
| `Filter.blur` | Blur |
| `Filter.boost` | Boost contrast and saturation |
| `Filter.contrast` | Increase contrast |
| `Filter.darken` | Darken the scene |
| `Filter.lighten` | Lighten the scene |
| `Filter.muted` | Reduce saturation and contrast |
| `Filter.negative` | Invert colors |

### CaptionAnimation

Animation styles for `CaptionAsset`.

| Value | Effect |
|-------|--------|
| `CaptionAnimation.box_highlight` | Highlight box around active words |
| `CaptionAnimation.color_highlight` | Color change on active words |
| `CaptionAnimation.reveal` | Words reveal progressively |
| `CaptionAnimation.karaoke` | Karaoke-style word-by-word |
| `CaptionAnimation.impact` | Impact emphasis effect |
| `CaptionAnimation.supersize` | Scale up active words |

### CaptionAlignment

| Value |
|-------|
| `bottom_left`, `bottom_center`, `bottom_right` |
| `middle_left`, `middle_center`, `middle_right` |
| `top_left`, `top_center`, `top_right` |

### CaptionBorderStyle

| Value | Description |
|-------|-------------|
| `CaptionBorderStyle.outline_and_shadow` | Outline with shadow (default) |
| `CaptionBorderStyle.opaque_box` | Solid box behind text |

---

## Helper Classes

### Transition

```python
Transition(in_: str = None, out: str = None, duration: int = 0.5)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `in_` | `str\|None` | `None` | Entry effect (e.g., `"fade"`). Underscore because `in` is a Python keyword. |
| `out` | `str\|None` | `None` | Exit effect (e.g., `"fade"`) |
| `duration` | `int` | `0.5` | Transition duration in seconds |

### Offset

```python
Offset(x: float = 0, y: float = 0)
```

Relative position shift. `x=0.3` shifts 30% right, `y=-0.2` shifts 20% up from the anchor position.

### Crop

```python
Crop(top: int = 0, right: int = 0, bottom: int = 0, left: int = 0)
```

Edge crop using a relative scale 0–1. `left=0.5` crops half the asset from the left.

### Font (for TextAsset)

```python
Font(family: str = "Clear Sans", size: int = 48, color: str = "#FFFFFF", opacity: float = 1.0)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `family` | `str` | `"Clear Sans"` | Font family |
| `size` | `int` | `48` | Font size in pixels |
| `color` | `str` | `"#FFFFFF"` | Hex color |
| `opacity` | `float` | `1.0` | 0.0 to 1.0 |

### Border (for TextAsset)

```python
Border(color: str = "#000000", width: float = 0.0)
```

### Shadow (for TextAsset)

```python
Shadow(color: str = "#000000", x: float = 0.0, y: float = 0.0)
```

### Background (for TextAsset)

```python
Background(
    width: float = 0.0,
    height: float = 0.0,
    color: str = "#000000",
    border_width: float = 0.0,
    opacity: float = 1.0,
    text_alignment: TextAlignment = TextAlignment.center,
)
```

### Alignment (for TextAsset)

```python
Alignment(
    horizontal: HorizontalAlignment = HorizontalAlignment.center,
    vertical: VerticalAlignment = VerticalAlignment.center,
)
```

`HorizontalAlignment`: `left`, `center`, `right`
`VerticalAlignment`: `top`, `center`, `bottom`

### FontStyling (for CaptionAsset)

```python
FontStyling(
    name: str = "Clear Sans",
    size: int = 30,
    bold: bool = False,
    italic: bool = False,
    underline: bool = False,
    strikeout: bool = False,
    scale_x: float = 100,
    scale_y: float = 100,
    spacing: float = 0.0,
    angle: float = 0.0,
)
```

### BorderAndShadow (for CaptionAsset)

```python
BorderAndShadow(
    style: CaptionBorderStyle = CaptionBorderStyle.outline_and_shadow,
    outline: int = 1,
    outline_color: str = "&H00000000",
    shadow: int = 0,
)
```

### Positioning (for CaptionAsset)

```python
Positioning(
    alignment: CaptionAlignment = CaptionAlignment.bottom_center,
    margin_l: int = 30,
    margin_r: int = 30,
    margin_v: int = 30,
)
```

---

## Supported Fonts

- Clear Sans (default)
- Noto Sans Devanagari
- Noto Sans Gurmukhi
- Noto Sans Gujarati
- Noto Sans Kannada

---

## Complete Examples

### Image slideshow with voiceover

```python
import videodb
from videodb.editor import Timeline, Track, Clip, ImageAsset, AudioAsset, Fit, Transition

conn = videodb.connect()
coll = conn.get_collection()

img1 = coll.generate_image(prompt="forest at dawn", aspect_ratio="16:9")
img2 = coll.generate_image(prompt="city at night", aspect_ratio="16:9")
voice = coll.generate_voice(text="From the calm of nature to the pulse of the city.")

timeline = Timeline(conn)
timeline.resolution = "1280x720"
timeline.background = "#000000"

image_track = Track()
image_track.add_clip(0, Clip(asset=ImageAsset(id=img1.id), duration=8, fit=Fit.crop,
    transition=Transition(in_="fade", out="fade", duration=0.5)))
image_track.add_clip(8, Clip(asset=ImageAsset(id=img2.id), duration=8, fit=Fit.crop,
    transition=Transition(in_="fade", out="fade", duration=0.5)))

voice_track = Track()
voice_track.add_clip(0, Clip(asset=AudioAsset(id=voice.id, volume=1.0), duration=voice.length))

timeline.add_track(image_track)
timeline.add_track(voice_track)

stream_url = timeline.generate_stream()
```

### Multi-track video with background music

```python
import videodb
from videodb.editor import Timeline, Track, Clip, VideoAsset, AudioAsset

conn = videodb.connect()
coll = conn.get_collection()

video = coll.get_video("your-video-id")
music = coll.generate_music(prompt="upbeat background", duration=int(video.length))

timeline = Timeline(conn)

video_track = Track()
video_track.add_clip(0, Clip(asset=VideoAsset(id=video.id, volume=1.0), duration=video.length))

music_track = Track()
music_track.add_clip(0, Clip(asset=AudioAsset(id=music.id, volume=0.2), duration=video.length))

timeline.add_track(video_track)
timeline.add_track(music_track)

stream_url = timeline.generate_stream()
```

### Append YouTube video as outro

```python
import videodb
from videodb.editor import Timeline, Track, Clip, ImageAsset, AudioAsset, VideoAsset, Fit, Transition

conn = videodb.connect()
coll = conn.get_collection()

img = coll.generate_image(prompt="thank you screen", aspect_ratio="16:9")
voice = coll.generate_voice(text="Thanks for watching. Here's a song to end the day.")
outro = coll.upload(url="https://www.youtube.com/watch?v=VIDEO_ID")

timeline = Timeline(conn)
timeline.resolution = "1280x720"
timeline.background = "#000000"

main_track = Track()
main_track.add_clip(0, Clip(asset=ImageAsset(id=img.id), duration=voice.length, fit=Fit.crop))

voice_track = Track()
voice_track.add_clip(0, Clip(asset=AudioAsset(id=voice.id, volume=1.0), duration=voice.length))

outro_track = Track()
outro_track.add_clip(voice.length, Clip(
    asset=VideoAsset(id=outro.id, volume=1.0),
    duration=min(outro.length, 60.0),
))

timeline.add_track(main_track)
timeline.add_track(voice_track)
timeline.add_track(outro_track)

stream_url = timeline.generate_stream()
```
