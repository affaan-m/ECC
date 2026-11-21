# Migration: v1 → v2 Indexing

SDK 0.5.0 introduced the **understand → index → retrieve** pipeline. This page maps the old API onto the new one and lists what changed behaviour.

**Nothing was removed.** Every v1 method still exists and works in 0.5.0, and none of them raise `DeprecationWarning`. You are not forced to migrate. New code should use v2 because it can do things v1 cannot — structured filtering, aggregation, grounded answers, and multiple named indexes per video.

For the v2 pipeline, see [indexing.md](indexing.md) and [search.md](search.md). For the v1 API as it stands, see [legacy/index.md](legacy/index.md) and [legacy/search.md](legacy/search.md).

## Contents

- Breaking changes in 0.5.0 (return type, routing, removed symbols)
- Method mapping (v1 call to v2 equivalent)
- Concept mapping
- What has no v2 equivalent
- Porting recipe

## Breaking changes in 0.5.0

These affect code that calls `search()` today, whether or not you migrate anything else.

| Change | Symptom | Fix |
|--------|---------|-----|
| `search()` returns `SearchResponse`, not `SearchResult` | `AttributeError: 'SearchResponse' object has no attribute 'stream_url'` — also `player_url`, `collection_id` | Use `results.compile()` for the URL. `get_shots()`, iteration, `len()`, `play()` still work |
| `search()` picks its engine by inspecting keywords | Silent behaviour change | `score_threshold=` and `filter=` do **not** route to legacy. See the routing note below |
| Mixing v1 and v2 keywords in one `search()` call | `ValueError` | Split into two calls, or use `legacy_search()` |
| `index_name` / `index_names` / `index_ids` passed to `search()` | `ValueError` | `search()` selects indexes automatically. Use `semantic_search()` to target them |
| Server migration notices | `UserWarning` at runtime, once per code per process | Read `response.warnings` |

### The routing sharp edge

`video.search(query, score_threshold=0.3)` was a v1 pattern. In 0.5.0 `score_threshold` is in neither the legacy-trigger set nor the v2 keyword set, so the call routes to **v2** and searches v2 indexes — which may not exist yet.

```python
# v1 intent, now runs against v2:
video.search(query, score_threshold=0.3)

# v2:
video.semantic_search(query, score_threshold=0.3)

# v1, explicitly:
video.legacy_search(query, score_threshold=0.3)
```

The same applies to `filter=`. Anything else from the legacy list — `search_type`, `index_type`, `scene_index_id`, `result_threshold`, and so on — does still route to legacy.

---

## Method mapping

| v1 (still works) | v2 |
|------------------|-----|
| `video.index_spoken_words(force=True)` | `video.understand(analyzers=[{"type": "spoken_words"}])` → `video.index(source=analyzer)` |
| `video.index_scenes(extraction_type, prompt)` → `scene_index_id` | `video.understand(analyzers=[{"type": "vlm", "config": {"prompt": ...}}])` → `video.index(source=analyzer)` |
| `video.index_visuals(prompt, batch_config)` | a `vlm` analyzer, with run-level `segmentation` and per-analyzer `sampling` |
| `video.index_audio(prompt, batch_config)` | a `spoken_words` analyzer, plus a `vlm` analyzer with `inputs=["transcript"]` when you want reasoning over it |
| `SceneExtractionType.shot_based` | `segmentation={"type": "shot", "threshold": 30}` |
| `SceneExtractionType.time_based`, `extraction_config={"time": 5}` | `segmentation={"type": "time", "seconds": 5}` |
| `extraction_config={"frame_count": 2, "select_frames": [...]}` | `sampling={"strategy": "uniform", "frame_count": 8}` or `{"strategy": "interval", "every": 1}` |
| `model_name="pro"`, `model_config` | analyzer `config={"model": "pro"}` |
| `metadata={...}` on `index_scenes()` | record `metadata`, plus the field in `fields["filter"]` — metadata is filterable now |
| `video.get_scene_index(id)` → `list[dict]` | `index.records(limit=, cursor=)` → `RecordPage`, or `analyzer.get_output()` |
| `video.list_scene_index()` | `video.list_indexes()` and `video.list_understandings()` |
| `video.delete_scene_index(id)` | `video.delete_index(index_id)` or `index.delete()` |
| `video.search(q, search_type=SearchType.semantic)` | `video.search(q)` — note the return type change |
| `video.search(q, index_type=IndexType.scene, scene_index_id=x)` | `video.semantic_search(q, index_names=["scene"])` |
| `video.search(q, score_threshold=0.3)` | `video.semantic_search(q, score_threshold=0.3)` — the v1 form now runs v2 |
| `video.search(q, result_threshold=10)` | `top_k=10` |
| `video.search(q, filter=[...])` | `video.query(index_name=..., filter=[...])`, or `semantic_search(filter=...)` |
| `coll.search(q)` — semantic only | `coll.search`, `coll.ask`, `coll.semantic_search`, `coll.query`, `coll.aggregate` |
| an LLM loop over `get_scene_index()` output | `video.ask(question, include_sources=True)` |
| counting scene records by hand | `video.aggregate(index_name=..., group_by=..., metric="count")` |
| `rtstream.index_visuals(prompt, batch_config)` | `rtstream.understand(...)` → `rtstream.index(source=understanding.outputs["scene"])` |
| `RTStreamSceneIndex.get_scenes()` | `RTStreamIndex.get_records()` |
| `scene_index.create_alert(...)` | `rtstream_index.create_alert(...)` — same signature |
| the `re.search(r"id\s+([a-f0-9]+)", str(e))` "index already exists" workaround | **gone.** `video.index()` is not force-gated. Use `video.get_index(name=...)` to fetch an existing index |

That last row is the one to internalise. v1 had no way to ask "does this index already exist", so the documented workaround was to call `index_scenes()`, let it fail, and scrape the ID out of the error string. v2 has `get_index(name=...)`. Delete the regex.

---

## Concept mapping

| v1 | v2 |
|----|-----|
| `scene_index_id` — an opaque string | `Index` — an object with status, fields, and records |
| One scene index per video, effectively | Many named indexes per video, each with its own capabilities |
| "Descriptions" — one blob of prose per scene | Typed artifact fields, optionally schema-controlled |
| No schema | `index.field_schema`: per-field type, groups, and supported operators |
| Indexing and searching are one step | Understanding, indexing, and retrieval are three, so one artifact can back several indexes |
| Search or nothing | `search`, `ask`, `semantic_search`, `query`, `aggregate` |

---

## What has no v2 equivalent

Keep using these:

- **`video.extract_scenes()` / `get_scene_collection()`** — the only way to get viewable frame image URLs. Scene collections are unchanged and still current.
- **`video.generate_transcript()` for subtitles and captions.** `video.add_subtitle()` and `CaptionAsset(src="auto")` read the video's transcript, which `generate_transcript()` or a `spoken_words` analyzer run creates. `index_spoken_words()` is not needed for them.

---

## Porting recipe

1. **Find the v1 calls.** Grep for `index_scenes`, `index_spoken_words`, `index_visuals`, `index_audio`, `get_scene_index`, `scene_index_id`.
2. **Collapse the indexing calls into one `understand()`.** Each v1 call becomes one analyzer in the list. `index_spoken_words` → `{"type": "spoken_words"}`; `index_scenes`/`index_visuals` → `{"type": "vlm"}`.
3. **Move extraction config up to run level.** `extraction_type` and `extraction_config["time"]`/`["threshold"]` become `segmentation`. `frame_count`/`select_frames` become per-analyzer `sampling`.
4. **Move the prompt and model into analyzer `config`.** Add a `schema` if you want fields you can filter and count on later.
5. **Delete the try/except regex block.** Replace it with `understanding.wait_until_complete()`, then `video.index(source=analyzer)` per successful analyzer, then `index.wait_until_complete()`.
6. **Rewrite the searches.** `search(index_type=..., scene_index_id=...)` → `semantic_search(index_names=[...])`. `result_threshold` → `top_k`. Anything reading `.stream_url` off a search result → `.compile()`.
7. **Verify.** `video.list_indexes()` should show your new indexes with `status == "ready"`; `index.field_schema` shows what you can filter and sort on.

Keep the v1 indexes until the v2 ones are ready — they coexist without conflict.
