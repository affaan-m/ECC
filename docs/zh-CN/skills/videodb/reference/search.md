# 搜索与索引指南

搜索功能允许您使用自然语言查询、精确关键词或视觉场景描述来查找视频中的特定时刻。

## 前提条件

视频**必须被索引**后才能进行搜索。每种索引类型对每个视频只需执行一次索引操作。

## 索引

### 口语词索引

为视频的转录语音内容建立索引，以支持语义搜索和关键词搜索：

```python
video = coll.get_video(video_id)

# force=True makes indexing idempotent — skips if already indexed
video.index_spoken_words(force=True)
```

此操作会转录音轨，并在口语内容上构建可搜索的索引。这是进行语义搜索和关键词搜索所必需的。

**参数：**

| 参数 | 类型 | 默认值 | 描述 |
|-----------|------|---------|-------------|
| `language_code` | `str\|None` | `None` | 视频的语言代码 |
| `segmentation_type` | `SegmentationType` | `SegmentationType.sentence` | 分割类型 (`sentence` 或 `llm`) |
| `force` | `bool` | `False` | 设置为 `True` 以跳过已索引的情况（避免“已存在”错误） |
| `callback_url` | `str\|None` | `None` | 用于异步通知的 Webhook URL |

### 场景索引

通过生成场景的 AI 描述来索引视觉内容。与口语词索引类似，如果场景索引已存在，此操作会引发错误。从错误消息中提取现有的 `scene_index_id`。

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

**提取类型：**

| 类型 | 描述 | 最佳适用场景 |
|------|-------------|----------|
| `SceneExtractionType.shot_based` | 基于视觉镜头边界进行分割 | 通用目的，动作内容 |
| `SceneExtractionType.time_based` | 按固定间隔进行分割 | 均匀采样，长时间静态内容 |
| `SceneExtractionType.transcript` | 基于转录片段进行分割 | 语音驱动的场景边界 |

**`time_based` 的参数：**

```python
video.index_scenes(
    extraction_type=SceneExtractionType.time_based,
    extraction_config={"time": 5, "select_frames": ["first", "last"]},
    prompt="Describe what is happening in this scene.",
)
```

## 搜索类型

### 语义搜索

使用自然语言查询匹配口语内容：

```python
from videodb import SearchType

results = video.search(
    query="explaining the benefits of machine learning",
    search_type=SearchType.semantic,
)
```

返回口语内容在语义上与查询匹配的排序片段。

### 关键词搜索

在转录语音中进行精确术语匹配：

```python
results = video.search(
    query="artificial intelligence",
    search_type=SearchType.keyword,
)
```

返回包含精确关键词或短语的片段。

### 场景搜索

视觉内容查询与已索引的场景描述进行匹配。需要事先调用 `index_scenes()`。

`index_scenes()` 返回一个 `scene_index_id`。将其传递给 `video.search()` 以定位特定的场景索引（当视频有多个场景索引时尤其重要）：

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

**重要说明：**

* 将 `SearchType.semantic` 与 `index_type=IndexType.scene` 结合使用——这是最可靠的组合，适用于所有套餐。
* `SearchType.scene` 存在，但可能并非在所有套餐中都可用（例如免费套餐）。建议优先使用 `SearchType.semantic` 与 `IndexType.scene`。
* `scene_index_id` 参数是可选的。如果省略，搜索将针对视频上的所有场景索引运行。传递此参数以定位特定索引。
* 您可以为每个视频创建多个场景索引（使用不同的提示或提取类型），并使用 `scene_index_id` 独立搜索它们。

### 带元数据筛选的场景搜索

使用自定义元数据索引场景时，可以将语义搜索与元数据筛选器结合使用：

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

有关自定义元数据索引和筛选搜索的完整示例，请参阅 [scene\_level\_metadata\_indexing 示例](https://github.com/video-db/videodb-cookbook/blob/main/quickstart/scene_level_metadata_indexing.ipynb)。

## 处理结果

### 获取片段

访问单个结果片段：

```python
results = video.search("your query")

for shot in results.get_shots():
    print(f"Video: {shot.video_id}")
    print(f"Start: {shot.start:.2f}s")
    print(f"End: {shot.end:.2f}s")
    print(f"Text: {shot.text}")
    print("---")
```

### 播放编译结果

将所有匹配片段作为单个编译视频进行流式播放：

```python
results = video.search("your query")
stream_url = results.compile()
results.play()  # opens compiled stream in browser
```

### 提取剪辑

下载或流式播放特定的结果片段：

```python
for shot in results.get_shots():
    stream_url = shot.generate_stream()
    print(f"Clip: {stream_url}")
```

## 跨集合搜索

跨集合中的所有视频进行搜索：

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

> **注意：** 集合级搜索仅支持 `SearchType.semantic`。将 `SearchType.keyword` 或 `SearchType.scene` 与 `coll.search()` 结合使用将引发 `NotImplementedError`。要进行关键词或场景搜索，请改为对单个视频使用 `video.search()`。

## 搜索 + 编译

对匹配片段进行索引、搜索并编译成单个可播放的流：

```python
video.index_spoken_words(force=True)
results = video.search(query="your query", search_type=SearchType.semantic)
stream_url = results.compile()
print(stream_url)
```

## 提示

* **一次索引，多次搜索**：索引是昂贵的操作。一旦索引完成，搜索会很快。
* **组合索引类型**：同时索引口语词和场景，以便在同一视频上启用所有搜索类型。
* **优化查询**：语义搜索最适合描述性的自然语言短语，而不是单个关键词。
* **使用关键词搜索提高精度**：当您需要精确的术语匹配时，关键词搜索可以避免语义漂移。
* **处理“未找到结果”**：当没有结果匹配时，`video.search()` 会引发 `InvalidRequestError`。始终将搜索调用包装在 try/except 中，并将 `"No results found"` 视为空结果集。
* **过滤场景搜索噪声**：对于模糊查询，语义场景搜索可能会返回低相关性的结果。使用 `score_threshold=0.3`（或更高值）来过滤噪声。
* **幂等索引**：使用 `index_spoken_words(force=True)` 可以安全地重新索引。`index_scenes()` 没有 `force` 参数——将其包装在 try/except 中，并使用 `re.search(r"id\s+([a-f0-9]+)", str(e))` 从错误消息中提取现有的 `scene_index_id`。
