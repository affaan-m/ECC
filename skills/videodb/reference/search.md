# Search & Indexing Guide

Search allows you to find specific moments inside videos using natural language queries, exact keywords, or visual scene descriptions.

## Prerequisites

Videos **must be indexed** before they can be searched. Indexing is a one-time operation per video per index type.

## Indexing

### Spoken Word Index

Index the transcribed speech content of a video for semantic and keyword search:

```python
video = coll.get_video(video_id)

# force=True makes indexing idempotent — skips if already indexed
video.index_spoken_words(force=True)
```

This transcribes the audio track and builds a searchable index over the spoken content. Required for semantic search and keyword search.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `language_code` | `str\|None` | `None` | Language code of the video |
| `segmentation_type` | `SegmentationType` | `SegmentationType.sentence` | Segmentation type (`sentence` or `llm`) |
| `force` | `bool` | `False` | Set to `True` to skip if already indexed (avoids "already exists" error) |
| `callback_url` | `str\|None` | `None` | Webhook URL for async notification |

### Scene Index

Index visual content by generating AI descriptions of scenes. Like spoken word indexing, this raises an error if a scene index already exists. Extract the existing `scene_index_id` from the error message.

```python
import re
from videodb import SceneExtractionType

try:
    scene_index_id = video.index_scenes(
        extraction_type=SceneExtractionType.shot_based,
        prompt="Describe the visual content, objects, actions, and setting in this scene.",
    )
except Exception as e:
    match = re.search(r"id\s+([a-f0-9]+)", str(e))
    if match:
        scene_index_id = match.group(1)
    else:
        raise
```

**Extraction types:**

| Type | Description | Best For |
|------|-------------|----------|
| `SceneExtractionType.shot_based` | Splits on visual shot boundaries | General purpose, action content |
| `SceneExtractionType.time_based` | Splits at fixed intervals | Uniform sampling, long static content |
| `SceneExtractionType.transcript` | Splits based on transcript segments | Speech-driven scene boundaries |

**Parameters for `time_based`:**

```python
video.index_scenes(
    extraction_type=SceneExtractionType.time_based,
    extraction_config={"time": 5, "select_frames": ["first", "last"]},
    prompt="Describe what is happening in this scene.",
)
```

## Search Types

### Semantic Search

Natural language queries matched against spoken content:

```python
from videodb import SearchType

results = video.search(
    query="explaining the benefits of machine learning",
    search_type=SearchType.semantic,
)
```

Returns ranked segments where the spoken content semantically matches the query.

### Keyword Search

Exact term matching in transcribed speech:

```python
results = video.search(
    query="artificial intelligence",
    search_type=SearchType.keyword,
)
```

Returns segments containing the exact keyword or phrase.

### Scene Search

Visual content queries matched against indexed scene descriptions. Requires a prior `index_scenes()` call.

`index_scenes()` returns a `scene_index_id`. Pass it to `video.search()` to target a specific scene index (especially important when a video has multiple scene indexes):

```python
from videodb import SearchType, IndexType
from videodb.exceptions import InvalidRequestError

# Search using semantic search against the scene index.
# Use score_threshold to filter low-relevance noise (recommended: 0.3+).
try:
    results = video.search(
        query="person writing on a whiteboard",
        search_type=SearchType.semantic,
        index_type=IndexType.scene,
        scene_index_id=scene_index_id,
        score_threshold=0.3,
    )
    shots = results.get_shots()
except InvalidRequestError as e:
    if "No results found" in str(e):
        shots = []
    else:
        raise
```

**Important notes:**

- Use `SearchType.semantic` with `index_type=IndexType.scene` — this is the most reliable combination and works on all plans.
- `SearchType.scene` exists but may not be available on all plans (e.g. Free tier). Prefer `SearchType.semantic` with `IndexType.scene`.
- The `scene_index_id` parameter is optional. If omitted, the search runs against all scene indexes on the video. Pass it to target a specific index.
- You can create multiple scene indexes per video (with different prompts or extraction types) and search them independently using `scene_index_id`.

### Scene Search with Metadata Filtering

When indexing scenes with custom metadata, you can combine semantic search with metadata filters:

```python
from videodb import SearchType, IndexType

results = video.search(
    query="a skillful chasing scene",
    search_type=SearchType.semantic,
    index_type=IndexType.scene,
    scene_index_id=scene_index_id,
    filter=[{"camera_view": "road_ahead"}, {"action_type": "chasing"}],
)
```

See the [scene_level_metadata_indexing cookbook](https://github.com/video-db/videodb-cookbook/blob/main/quickstart/scene_level_metadata_indexing.ipynb) for a full example of custom metadata indexing and filtered search.

## Working with Results

### Get Shots

Access individual result segments:

```python
results = video.search("your query")

for shot in results.get_shots():
    print(f"Video: {shot.video_id}")
    print(f"Start: {shot.start:.2f}s")
    print(f"End: {shot.end:.2f}s")
    print(f"Text: {shot.text}")
    print("---")
```

### Play Compiled Results

Stream all matching segments as a single compiled video:

```python
results = video.search("your query")
stream_url = results.compile()
results.play()  # opens compiled stream in browser
```

### Extract Clips

Download or stream specific result segments:

```python
for shot in results.get_shots():
    stream_url = shot.generate_stream()
    print(f"Clip: {stream_url}")
```

## Cross-Collection Search

Search across all videos in a collection:

```python
coll = conn.get_collection()

# Search across all videos in the collection
results = coll.search(
    query="product demo",
    search_type=SearchType.semantic,
)

for shot in results.get_shots():
    print(f"Video: {shot.video_id} [{shot.start:.1f}s - {shot.end:.1f}s]")
```

> **Note:** Collection-level search only supports `SearchType.semantic`. Using `SearchType.keyword` or `SearchType.scene` with `coll.search()` will raise `NotImplementedError`. For keyword or scene search, use `video.search()` on individual videos instead.

## Search + Compile

Index, search, and compile matching segments into a single playable stream:

```python
video.index_spoken_words(force=True)
results = video.search(query="your query", search_type=SearchType.semantic)
stream_url = results.compile()
print(stream_url)
```

## Tips

- **Index once, search many times**: Indexing is the expensive operation. Once indexed, searches are fast.
- **Combine index types**: Index both spoken words and scenes to enable all search types on the same video.
- **Refine queries**: Semantic search works best with descriptive, natural language phrases rather than single keywords.
- **Use keyword search for precision**: When you need exact term matches, keyword search avoids semantic drift.
- **Handle "No results found"**: `video.search()` raises `InvalidRequestError` when no results match. Always wrap search calls in try/except and treat `"No results found"` as an empty result set.
- **Filter scene search noise**: Semantic scene search can return low-relevance results for vague queries. Use `score_threshold=0.3` (or higher) to filter noise.
- **Idempotent indexing**: Use `index_spoken_words(force=True)` to safely re-index. `index_scenes()` has no `force` parameter — wrap it in try/except and extract the existing `scene_index_id` from the error message with `re.search(r"id\s+([a-f0-9]+)", str(e))`.
