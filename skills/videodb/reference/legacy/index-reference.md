# Scene Index & Extraction Reference (v1)

> **LEGACY — do not use for new code.** This page documents the v1 scene-index API. Every method here **still works in SDK 0.5.0 and is not deprecated** — nothing raises `DeprecationWarning`. The server may attach migration notices to `response.warnings`, surfaced as Python `UserWarning`. Read this only when maintaining existing v1 code.
>
> New code: [../indexing-reference.md](../indexing-reference.md) → [../search-reference.md](../search-reference.md). To port existing code: [../migration.md](../migration.md).

Code-level details for VideoDB scene indexing and extraction. For workflow guide, see [index.md](index.md).

---

## Contents

- Imports
- Video Scene Methods
- index_scenes
- extract_scenes
- Extraction Types and Configs
- SceneCollection
- Scene
- Frame
- Scene Index Record

## Imports

```python
from videodb import SceneExtractionType
from videodb.scene import SceneCollection, Scene, Frame
```

---

## Video Scene Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `video.index_scenes(extraction_type, extraction_config, prompt, metadata, model_name, model_config, name, scenes, callback_url)` | `str\|None` | Index scenes with AI descriptions (returns `scene_index_id`) |
| `video.extract_scenes(extraction_type, extraction_config, force, callback_url)` | `SceneCollection\|None` | Extract scenes with frame images |
| `video.get_scene_index(scene_index_id)` | `list[dict]\|None` | Get scene index records (each dict has `start`, `end`, `description`) |
| `video.list_scene_index()` | `list` | List all scene indexes for this video |
| `video.delete_scene_index(scene_index_id)` | `None` | Delete a scene index |
| `video.list_scene_collection()` | `list` | List all scene collections for this video |
| `video.get_scene_collection(collection_id)` | `SceneCollection\|None` | Get a scene collection with frame images |
| `video.delete_scene_collection(collection_id)` | `None` | Delete a scene collection |
| `video.get_scenes()` | `list\|None` | **Deprecated since v0.2.0.** Use `get_scene_index()` instead |

---

## index_scenes

```python
video.index_scenes(
    extraction_type=SceneExtractionType.shot_based,  # shot_based, time_based, or transcript
    extraction_config={},                             # type-specific config (see below)
    prompt=None,                                      # AI prompt for describing scenes
    metadata={},                                      # metadata dict attached to the index
    model_name=None,                                  # model to use for descriptions
    model_config=None,                                # model configuration dict
    name=None,                                        # optional name for the index
    scenes=None,                                      # optional pre-built Scene list
    callback_url=None,                                # webhook URL for async notification
)
```

Returns `str` — the `scene_index_id`. Raises an error if an index already exists (no `force` parameter). Use the `re.search(r"id\s+([a-f0-9]+)", str(e))` pattern to extract the existing ID.

## extract_scenes

```python
video.extract_scenes(
    extraction_type=SceneExtractionType.shot_based,  # shot_based or time_based
    extraction_config={},                             # type-specific config (see below)
    force=False,                                      # True to re-extract even if collection exists
    callback_url=None,                                # webhook URL for async notification
)
```

Returns `SceneCollection` with `.scenes` list. Each scene contains `.frames` with viewable image URLs.

---

## Extraction Types and Configs

### SceneExtractionType

```python
from videodb import SceneExtractionType

SceneExtractionType.shot_based   # Automatic shot boundary detection
SceneExtractionType.time_based   # Fixed time interval extraction
SceneExtractionType.transcript   # Transcript-based scene extraction
```

### shot_based config

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threshold` | `int` | `20` | Sensitivity for shot detection. Higher = fewer splits |
| `frame_count` | `int` | `1` | Frames to extract per shot |

```python
extraction_config={"threshold": 30, "frame_count": 2}
```

### time_based config

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `time` | `int` | `10` | Interval in seconds per scene |
| `frame_count` | `int` | `1` | Frames to extract per scene |
| `select_frames` | `list[str]` | `["first"]` | Which frames: `"first"`, `"middle"`, `"last"` |

```python
extraction_config={"time": 5, "select_frames": ["first", "last"]}
```

```python
extraction_config={"time": 1, "frame_count": 2}
```

---

## SceneCollection

```python
scene_collection = video.extract_scenes(...)
# or
scene_collection = video.get_scene_collection(collection_id)
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `.id` | `str` | Unique collection ID |
| `.video_id` | `str` | Parent video ID |
| `.config` | `dict` | Extraction configuration used |
| `.scenes` | `list[Scene]` | List of Scene objects |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `.delete()` | `None` | Delete this scene collection |

---

## Scene

```python
for scene in scene_collection.scenes:
    print(scene.start, scene.end, scene.description)
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `.id` | `str` | Unique scene ID |
| `.video_id` | `str` | Parent video ID |
| `.start` | `float` | Start time in seconds |
| `.end` | `float` | End time in seconds |
| `.description` | `str` | Text description (empty until `.describe()` is called or populated by extraction) |
| `.frames` | `list[Frame]` | List of Frame objects with image URLs |
| `.metadata` | `dict` | Metadata attached to this scene |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `.describe(prompt=None, model_name=None)` | `str` | Generate AI description (updates `.description` and returns it) |
| `.to_json()` | `dict` | Serialize to dict with `id`, `video_id`, `start`, `end`, `frames`, `description`, `metadata` |

---

## Frame

`Frame` extends `Image`. Each frame is an actual image extracted from the video at a specific timestamp.

```python
for scene in scene_collection.scenes:
    for frame in scene.frames:
        print(f"  {frame.frame_time}s — {frame.url}")
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `.id` | `str` | Unique frame ID |
| `.video_id` | `str` | Parent video ID |
| `.scene_id` | `str` | Parent scene ID |
| `.url` | `str` | Viewable image URL |
| `.frame_time` | `float` | Timestamp in the video (seconds) |
| `.description` | `str` | Text description (empty until `.describe()` is called) |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `.generate_url()` | `str` | Generate a signed URL (inherited from Image) |
| `.describe(prompt=None, model_name=None)` | `str` | Generate AI description (updates `.description` and returns it) |
| `.to_json()` | `dict` | Serialize to dict with `id`, `video_id`, `scene_id`, `url`, `frame_time`, `description` |
| `.delete()` | `None` | Delete this frame (inherited from Image) |

---

## Scene Index Record

Records returned by `video.get_scene_index(scene_index_id)`:

```python
[
    {"start": 0.0, "end": 5.0, "description": "A person presenting slides..."},
    {"start": 5.0, "end": 10.0, "description": "An animated bar chart..."},
    ...
]
```

| Field | Type | Description |
|-------|------|-------------|
| `start` | `float` | Start time in seconds |
| `end` | `float` | End time in seconds |
| `description` | `str` | AI-generated description of visual content |
