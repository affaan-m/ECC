# Scene Indexing & Extraction Guide (v1)

> **LEGACY — do not use for new code.** This page documents the v1 scene-index API. Every method here **still works in SDK 0.5.0 and is not deprecated** — nothing raises `DeprecationWarning`. The server may attach migration notices to `response.warnings`, surfaced as Python `UserWarning`. Read this only when maintaining existing v1 code.
>
> New code: [../indexing.md](../indexing.md) → [../search.md](../search.md). To port existing code: [../migration.md](../migration.md).

VideoDB provides two distinct ways to analyze visual content in videos: **Scene Indexes** (AI-generated text descriptions) and **Scene Collections** (extracted frames with image URLs). Use indexes when you need searchable descriptions or text analysis. Use collections when you need to see the actual frames.

`extract_scenes()` and scene collections have **no v2 equivalent** — they remain the only way to get viewable frame image URLs, and are still current for that purpose.

For code-level details (method signatures, class properties, extraction configs), see [index-reference.md](index-reference.md).

---

## Contents

- Two Concepts (scene index vs scene collection)
- Indexing Scenes
- Reading Back Descriptions
- Extracting Scenes with Frames
- Describing Scenes and Frames
- Managing Indexes and Collections
- Video vs RTStream
- Deprecated: `video.get_scenes()`

## Two Concepts

### Scene Index

A scene index is a set of AI-generated text descriptions of what's visually on screen at each moment. Created by `index_scenes()`, read back with `get_scene_index()`.

- Returns `list[dict]` — each dict has `start`, `end`, `description`
- Searchable via `video.search()` with `IndexType.scene`
- Multiple indexes can exist per video (each has a unique `scene_index_id`)
- No frame images — text only

### Scene Collection

A scene collection is a set of extracted scenes, each containing actual frame images with URLs you can view. Created by `extract_scenes()`, retrieved with `get_scene_collection()`.

- Returns a `SceneCollection` object with `.scenes` (list of `Scene` objects)
- Each `Scene` has `.frames` — list of `Frame` objects with `.url` (viewable image URL)
- Use for visual inspection, quality review, thumbnail generation
- Not searchable — use scene indexes for search

### When to Use Which

| Goal | Use |
|------|-----|
| Search for specific visual content | Scene Index → `video.search()` |
| Read back text descriptions of every scene | Scene Index → `get_scene_index()` |
| View actual frame images | Scene Collection → `extract_scenes()` |
| Programmatic quality review (see what's on screen) | Scene Collection (frame URLs) + Scene Index (descriptions) |
| Feed visual context to an LLM | Scene Index (descriptions) or Frame `.describe()` |

---

## Indexing Scenes

Create a scene index with AI descriptions. The `scene_index_id` is used for search and retrieval.

```python
import re
from videodb import SceneExtractionType

try:
    scene_index_id = video.index_scenes(
        extraction_type=SceneExtractionType.shot_based,
        prompt="Describe the visual content, objects, actions, and setting in this scene.",
    )
except Exception as e:
    # index_scenes() raises an error if an index already exists.
    # Extract the existing index ID from the error message.
    match = re.search(r"id\s+([a-f0-9]+)", str(e))
    if match:
        scene_index_id = match.group(1)
    else:
        raise
```

### Extraction Types

| Type | How it splits | Best for |
|------|---------------|----------|
| `SceneExtractionType.shot_based` | Visual shot boundary detection | General purpose, action content |
| `SceneExtractionType.time_based` | Fixed time intervals | Uniform sampling, long/static content |
| `SceneExtractionType.transcript` | Transcript segment boundaries | Speech-driven scene splits |

### Time-Based Config

```python
scene_index_id = video.index_scenes(
    extraction_type=SceneExtractionType.time_based,
    extraction_config={
        "time": 5,                           # seconds per scene
        "select_frames": ["first", "last"],  # which frames to analyze
    },
    prompt="Describe what is happening in this scene.",
)
```

For fine-grained review (e.g., 1-second intervals with 2 frames each):

```python
scene_index_id = video.index_scenes(
    extraction_type=SceneExtractionType.time_based,
    extraction_config={"time": 1, "select_frames": ["first", "last"]},
    prompt="Describe the visual content: what type of visual (chart, browser, text, video clip, image), what it shows, any text visible on screen.",
)
```

---

## Reading Back Descriptions

After indexing, read all descriptions without searching. `get_scene_index()` returns a flat list of dicts:

```python
records = video.get_scene_index(scene_index_id)
for record in records:
    print(f"[{record['start']}s - {record['end']}s] {record['description']}")
```

Each record is a dict:
```python
{"start": 0.0, "end": 5.0, "description": "A bar chart showing growth rates across industries..."}
```

This is useful for:
- Comparing intended vs actual visual content (e.g., in a review loop)
- Feeding scene descriptions into an LLM for analysis
- Building a visual timeline of what's on screen

---

## Extracting Scenes with Frames

`extract_scenes()` returns a `SceneCollection` with actual frame images:

```python
from videodb import SceneExtractionType

scene_collection = video.extract_scenes(
    extraction_type=SceneExtractionType.time_based,
    extraction_config={"time": 1, "select_frames": ["first", "last"]},
)

for scene in scene_collection.scenes:
    print(f"\nScene {scene.start}s - {scene.end}s")
    print(f"  Description: {scene.description}")
    for frame in scene.frames:
        print(f"  Frame at {frame.frame_time}s: {frame.url}")
```

Each `Frame` has a `.url` property — a viewable image URL. Download or view these to see exactly what's on screen at that moment.

### Force Re-extraction

```python
scene_collection = video.extract_scenes(
    extraction_type=SceneExtractionType.time_based,
    extraction_config={"time": 5},
    force=True,  # extract_scenes supports force, unlike index_scenes
)
```

---

## Describing Scenes and Frames

Scenes and frames start with empty or basic descriptions. Use `.describe()` to get AI-generated descriptions on demand:

```python
# Describe a specific scene
scene = scene_collection.scenes[0]
description = scene.describe(
    prompt="What is shown in this scene? Describe any text, charts, or UI elements.",
)
print(description)  # updates scene.description and returns it

# Describe a specific frame
frame = scene.frames[0]
frame_desc = frame.describe(
    prompt="What is visible in this frame?",
)
print(frame_desc)  # updates frame.description and returns it
```

---

## Managing Indexes and Collections

### Scene Indexes

```python
# List all scene indexes for this video
indexes = video.list_scene_index()
for idx in indexes:
    print(idx)

# Get records from a specific index
records = video.get_scene_index(scene_index_id)

# Delete an index
video.delete_scene_index(scene_index_id)
```

### Scene Collections

```python
# List all scene collections for this video
collections = video.list_scene_collection()
for coll in collections:
    print(coll)

# Retrieve a specific collection (with frame images)
scene_collection = video.get_scene_collection(collection_id)

# Delete a collection
video.delete_scene_collection(collection_id)
```

---

## Video vs RTStream

> **Important:** Video and RTStream have scene methods with the same names but **different return types**. Do not mix them.

| Method | Video (VOD) | RTStream (live) |
|--------|-------------|-----------------|
| `index_scenes()` | Returns `str` (scene_index_id) | Returns `RTStreamSceneIndex` object |
| `get_scene_index(id)` | Returns `list[dict]` (flat records) | Returns `RTStreamSceneIndex` object with `.get_scenes()` |
| `list_scene_index()` / `list_scene_indexes()` | Returns `list` | Returns `List[RTStreamSceneIndex]` |

For RTStream scene APIs, see [../rtstream-reference.md](../rtstream-reference.md).

---

## Deprecated: `video.get_scenes()`

`video.get_scenes()` is deprecated since v0.2.0. It takes no arguments and returns raw index data. Use `video.get_scene_index(scene_index_id)` instead to get descriptions from a specific index, or `video.extract_scenes()` to get frame images.
