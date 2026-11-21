# Understanding & Indexing Guide (v2)

Turn a video into structured, retrievable data in three stages: **understand → index → retrieve**.

For code-level details (signatures, class properties, validation errors), see [indexing-reference.md](indexing-reference.md). For retrieval, see [search.md](search.md). For the v1 scene-index API, see [legacy/index.md](legacy/index.md) and [migration.md](migration.md).

Requires `videodb>=0.5.0`.

Runnable notebooks covering every analyzer, segmentation and sampling, multi-analyzer pipelines, and custom indexes live in the [indexing-v2 cookbook](https://github.com/video-db/videodb-cookbook/tree/preview/guides/indexing-v2).

## Contents

- The three stages
- Minimal end-to-end
- Stage 1: Understanding (analyzers, segmentation, sampling, VLM config, structured output, chaining)
- Stage 2: Indexing (source forms, use_for, fields, build status)
- Index names across a collection
- Inspecting an index
- Managing runs and indexes
- Scope: video vs collection
- Cost and latency (frame count, interval, model tier)
- Gotchas

## The three stages

| Stage | Call | Produces | Async? |
|-------|------|----------|--------|
| 1. Understand | `video.understand(analyzers=[...])` | `Understanding` holding one **artifact** per analyzer | yes — `wait_until_complete()` |
| 2. Index | `video.index(source=analyzer)` | `Index` (retrievable) | validation sync, embedding async |
| 3. Retrieve | `search` / `ask` / `semantic_search` / `query` / `aggregate` | shots, answers, rows | sync |

An **analyzer** extracts one kind of signal. Its output is an **artifact**. Indexing an artifact declares what you can do with it later. Understanding and indexing are separate, so one artifact can back several indexes with different capabilities.

---

## Minimal end-to-end

```python
import time

import videodb

conn = videodb.connect()
coll = conn.get_collection()
video = coll.get_video("your-video-id")

understanding = video.understand(
    analyzers=[
        {"type": "spoken_words", "name": "transcript"},
        {"type": "vlm", "name": "scene",
         "config": {"prompt": "Describe the scene and any on-screen text."}},
    ],
    segmentation={"type": "shot", "threshold": 30},
)

# A `partial` run is not terminal to the SDK — poll the analyzers, not the run.
# `analyzers and` is load-bearing: a refresh can transiently return an empty
# list, and all([]) is True, which would exit while the run is still going.
deadline = time.time() + 3600
while time.time() < deadline:
    analyzers = understanding.refresh().list_analyzers()
    if analyzers and all(a.is_complete for a in analyzers):
        break
    time.sleep(15)

for analyzer in understanding.list_analyzers():
    if not analyzer.is_successful:
        continue
    video.index(source=analyzer, name=analyzer.name).wait_until_complete()

response = video.search("discussion about pricing")
for shot in response.shots:
    print(f"[{shot.start:.1f}s - {shot.end:.1f}s] {shot.text}")
if response.response_type in ("shots", "deepsearch") and len(response):
    print(response.compile())
```

**Name your analyzers.** Index names default correctly either way — omit `name` on `index()` and the server derives `transcript`, `scene`, `objects` from the artifact type. The trap is passing `name=analyzer.name` for an analyzer you never named: the server assigns *analyzer* names like `vlm-3f2a91bc`, so that call creates an index called `vlm-3f2a91bc`, breaking `index_names=["scene"]` downstream. Naming the analyzer is also what makes `understanding.get_analyzer("scene")` resolve; without it that call raises `ValueError`.

So: either name every analyzer (as above), or call `video.index(source=analyzer)` with no `name=` and take the derived default. Do not mix the two.

---

## Stage 1: Understanding

### Analyzers

Each analyzer produces one artifact. Give every analyzer an explicit `name` — the conventional choice is the artifact name for its type:

| `type` | Artifact name | Fields it emits |
|--------|---------------|-----------------|
| `spoken_words` | `transcript` | `text`, `chunks`, `words`, `language`, `speaker` |
| `vlm` | `scene` | `scene_description`, `action`, `activity`, `location`, `setting`, `shot_type`, `emotion`, `topic`, `song_detection`, `character_description`, `object_description`, `brand_names`, `outputs`, `full_text` |
| `object_detection` | `objects` | `summary`, `frames`, `detections`, `objects` |
| `ocr` | `ocr` | `combined_text`, `text`, `words`, `language` |
| `brand_detection` | `brands` | `brand_names`, `brands`, `summary`, `detections` |
| `activity_recognition` | `activity` | `labels`, `activity`, `actions`, `detections` |
| `location_detection` | `location` | `location_type`, `setting`, `time_of_day`, `location` |
| `faces` | `faces` | `identities`, `detections`, `faces` |
| `audio_event_detection` | `audio_events` | `events`, `labels`, `audio_events` |

Those field names are what you reference in `fields` at index time and in `filter` at search time.

Analyzer types are plain strings — there is no SDK enum. Do not write `from videodb import AnalyzerType`.

These artifact names are what an index defaults to when you call `video.index(source=analyzer)` without a `name`. They are **not** what `analyzer.name` returns: an analyzer you didn't name gets a generated `{type}-{random}` value like `vlm-3f2a91bc`, which is also why `get_analyzer("scene")` would raise `ValueError`. Naming each analyzer keeps the two aligned.

### Segmentation

Run-level. Controls how the video is cut into timestamped scenes that analyzers operate on.

```python
video.understand(
    segmentation={"type": "time", "seconds": 5},    # fixed-length scenes
    analyzers=[{"type": "vlm"}],
)

video.understand(
    # cut-based scenes; min_scene_len keeps very short cuts from becoming their own scene
    segmentation={"type": "shot", "threshold": 30, "min_scene_len": 15},
    analyzers=[{"type": "vlm"}],
)
```

| Type | Keys | Use when |
|------|------|----------|
| `time` | `seconds` | Continuous or static footage, predictable cost, uniform sampling |
| `shot` | `threshold`, optional `min_scene_len` | Edited content where cuts are meaningful boundaries |

Segmentation is shared by every analyzer in the run.

> **Two spellings exist for the time window.** `seconds` (an integer) is what the official cookbook uses for the video pipeline; `window` (a string with a unit, e.g. `"5s"`) appears in the RTStream API and in parts of the server. If `seconds` appears to be ignored, try `{"type": "time", "window": "5s"}`.

### Sampling

Per-analyzer. Controls which frames within each scene reach the model.

```python
{"type": "vlm", "sampling": {"strategy": "uniform", "frame_count": 8}}   # N frames per scene
{"type": "object_detection", "sampling": {"strategy": "interval", "every": 1}}  # one frame per second
```

### Transform

Run-level preprocessing. Lower resolution costs less and runs faster.

```python
video.understand(transform={"resolution": "480p"}, analyzers=[...])
```

### VLM configuration

```python
{
    "type": "vlm",
    "name": "scene",
    "config": {
        "model": "pro",
        "prompt": "Describe the scene, the setting, and any visible text.",
    },
}
```

Managed model aliases, cheapest to most capable:

| Alias | Use when |
|-------|----------|
| `mini` | Lowest-cost lightweight analysis |
| `basic` | Routine extraction and descriptions |
| `pro` | Balanced default |
| `ultra` | Highest-quality complex reasoning |

You can also name a provider model directly, e.g. `"google/gemini-2.5-flash"` or a supported `openai/...` model. Managed models do not take `sandbox_id`; self-hosted ones do.

`config` is forwarded to the server untyped, so a misspelled tier fails server-side rather than at the call.

### Structured output

Give the VLM a `schema` to get typed fields instead of prose. This is what makes `query()` and `aggregate()` useful downstream — you can only filter and count on real fields.

Simple form — a type name per field:

```python
"schema": {
    "scene_description": "text",       # prose, embedded for semantic search
    "activity": "string",              # short label, good for filter/aggregate
    "visible_objects": ["string"],     # array shorthand
    "confidence": {"type": "number", "min": 0, "max": 1},
}
```

Richer form — enums, nested objects, and arrays of objects. Enums are worth the effort: a constrained vocabulary makes `aggregate(group_by=...)` produce clean buckets instead of free-text noise.

```python
"schema": {
    "scene_description": "text",
    "activity": {
        "type": "enum",
        "values": ["conversation", "using_device", "walking", "object_interaction", "other"],
    },
    "setting": {
        "type": "object",
        "fields": {
            "location_type": {"type": "enum", "values": ["office", "home", "outdoor", "vehicle"]},
            "environment": {"type": "enum", "values": ["indoor", "outdoor", "unknown"]},
        },
    },
    "object_descriptions": {
        "type": "array",
        "min_items": 0,
        "max_items": 4,
        "items": {"name": "string", "description": "string"},
    },
}
```

A field can be made optional and self-describing: `{"type": "string", "required": False, "description": "Visible setting, if identifiable."}`.

Two further `config` keys control how the schema is enforced:

| Key | Values | Purpose |
|-----|--------|---------|
| `schema_mode` | `auto` (default), `native_required`, `prompt_only` | Whether to use the provider's native structured output, require it, or fall back to prompting |
| `schema_max_retries` | int | Retries when the model returns output that doesn't satisfy the schema |

Nested schema fields are addressed downstream with dotted paths — `setting.location_type`, `object_descriptions.description` — in `fields`, in `filter`, and in `index_names`.

### Chaining analyzers

An analyzer can read earlier artifacts through `inputs`, and interpolate them into its prompt with `{{inputs.<name>}}`. Order in the list does not matter; `inputs` declares the dependency.

```python
understanding = video.understand(
    segmentation={"type": "shot", "threshold": 30},
    analyzers=[
        {"type": "object_detection", "name": "objects",
         "sampling": {"strategy": "interval", "every": 1}},
        {"type": "spoken_words", "name": "transcript"},
        {
            "type": "vlm",
            "name": "scene",
            "inputs": ["objects", "transcript"],
            "sampling": {"strategy": "uniform", "frame_count": 8},
            "config": {
                "prompt": (
                    "Describe the scene using the frames as primary evidence.\n\n"
                    "Spoken words:\n{{inputs.transcript}}\n\n"
                    "Detected objects:\n{{inputs.objects}}"
                ),
            },
        },
    ],
)
```

### Waiting

```python
understanding.wait_until_complete(timeout=1800, poll_interval=10)  # raises TimeoutError
```

Or pass `callback_url` to `understand()` and skip polling entirely.

> **A mixed run never satisfies `wait_until_complete()`.** Run statuses are `queued`, `running`, `done`, `partial`, `failed`. A run reports `done` only when *every* analyzer succeeded; if one fails or is skipped the run ends `partial` — and the SDK's terminal set is only `{done, failed}`, so polling continues until it raises `TimeoutError`. When some analyzers may legitimately fail, either use a short timeout and catch it, or poll the analyzers directly:

```python
import time

deadline = time.time() + 1800
while time.time() < deadline:
    understanding.refresh()
    if all(a.is_complete for a in understanding.list_analyzers()):
        break
    time.sleep(15)

for analyzer in understanding.list_analyzers():
    print(analyzer.name, analyzer.status)
```

### Reading analyzer output

`get_output()` returns timestamped scenes. Each scene carries `start`, `end`, `scene_id`, and a `data` dict holding that analyzer's fields:

```python
output = understanding.get_analyzer("scene").get_output()

# The payload is normally {"scenes": [...]} but can be a bare list — handle both.
scenes = output.get("scenes", output) if isinstance(output, dict) else output

for scene in scenes or []:
    print(scene["start"], scene["end"], scene["data"])
```

A transcript scene's `data` has `text`, `language`, `words`; a schema'd VLM scene's `data` has exactly the fields you declared. You do not need to read the output at all to index it — indexing by reference is cheaper — but it is the fastest way to see what an analyzer actually produced before you decide which fields to index.

---

## Stage 2: Indexing

### Source forms

```python
# 1. Analyzer object — preferred. Indexed by reference; scene data never leaves the server.
analyzer = understanding.get_analyzer("scene")
video.index(source=analyzer, name="scene")

# 2. That analyzer's output. Equivalent result, but the scenes round-trip through your process.
video.index(source=analyzer.get_output(), name="scene")

# 3. Reference dict, when you only have IDs.
video.index(name="scene", source={"understanding_id": "und_123", "analyzer_id": "an_456"})

# 4. Your own temporal records — no understanding run needed.
video.index(name="chapters", source=[
    {"start": 0.0, "end": 12.4, "summary": "Opening credits.", "chapter_type": "intro"},
    {"start": 12.4, "end": 98.0, "summary": "Product walkthrough.", "chapter_type": "demo"},
])
```

Forms 1 and 2 produce the same index. Prefer form 1 unless you already fetched the output for another reason.

Custom records require `start` and `end`; `scene_id` and `metadata` are optional and any other keys are indexable. Use this to bring third-party analysis into VideoDB search.

### Capabilities (`use_for`)

```python
video.index(source=analyzer, name="scene", use_for=["semantic", "query", "aggregate"])
```

| Capability | Unlocks |
|-----------|---------|
| `semantic` | `semantic_search()`, and `search()` over this index |
| `query` | `query()` — exact filters |
| `aggregate` | `aggregate()` — counts, grouping, facets |

Omitting `use_for` defaults to all three, **and degrades gracefully**: if no scene holds embeddable top-level text, the index quietly drops `semantic` and keeps `query` + `aggregate`. Asking for `semantic` explicitly on the same artifact raises `use_for includes semantic but no scene has embeddable text` instead. Omitting is forgiving; requesting is strict.

The trigger is the data, not the analyzer type. Artifacts whose text lives only in nested structures — object detection stores its labels under `frames.detections` — commonly degrade, but one that also emits a top-level `summary` will keep `semantic`. Check `index.use_for` after creation to see what you actually got.

### Field configuration

`fields` maps field groups to field names, and decides what is optimised for what. Unlisted fields are still stored and still returnable via `return_fields` — they just aren't searchable.

```python
scene = understanding.get_analyzer("scene")

video.index(
    source=scene,
    name="scene",
    use_for=["semantic", "query", "aggregate"],
    fields={
        "semantic": ["scene_description", "setting.location_type"],
        "filter": ["activity", "setting.location_type", "setting.environment"],
        "aggregate": ["activity", "setting.location_type"],
    },
)
```

Prose goes in `semantic`; enums and short labels go in `filter` and `aggregate`.

| Group | Purpose |
|-------|---------|
| `semantic` | Vector search |
| `filter` | `query()` conditions |
| `aggregate` | Grouping and faceting |
| `sort` | Result ordering |

Use dotted paths for nested data. When a path crosses a list, values are collected from **every** element:

```python
objects = understanding.get_analyzer("objects")

video.index(
    source=objects,
    name="objects",
    use_for=["query", "aggregate"],
    fields={
        "filter": ["frames.detections.label", "frames.detections.score"],
        "aggregate": ["frames.detections.label"],
        "sort": ["frames.detections.score"],
    },
)
```

### Default field derivation

Omitted groups are derived from your data. Well-known names get product defaults:

| Field | Default groups |
|-------|----------------|
| `text` | `semantic`, `fts` |
| `combined_text` | `semantic`, `fts` |
| `scene_description` | `semantic` |
| `language`, `brand_names` | `filter`, `aggregate` |
| `activity`, `location` | `semantic`, `filter`, `aggregate` |
| `frames.detections.label` | `filter`, `aggregate` |
| `frames.detections.score` | `filter`, `sort` |

Everything else is classified by shape: booleans → `filter`+`aggregate`; numbers → `filter`+`aggregate`+`sort`; strings → `filter`+`aggregate`, plus `semantic` when the value reads as prose; string arrays → `filter`+`aggregate`; nested objects and lists of objects get **no** group and are retrievable only through `return_fields`.

Declaring a group wins verbatim. An explicit empty list opts out rather than triggering derivation:

```python
fields={"semantic": ["scene_description"], "filter": []}   # no filter fields at all
```

`fts` (full-text) is applied automatically to `text` and `combined_text`, so transcripts and OCR are keyword-searchable without asking.

### Build status

```python
index.wait_until_complete(timeout=1800, poll_interval=10)

if index.is_successful:
    print(index.record_count, index.fields)
else:
    print(index.error)
```

| Status | Meaning |
|--------|---------|
| `building` | Ingest in progress, then embedding. Immediately after `index()` returns there may be **no rows yet**; once the ingest lands, `query()` and `aggregate()` work while embeddings finish |
| `ready` | Fully operational, including semantic search |
| `failed` | Build failed — read `index.error` |

Do not treat `building` as "queryable" without checking. If you need results straight away, wait for `ready`.

Field and source validation happens **synchronously**, on the `index()` call itself. A bad field path fails immediately and the error lists the field names that do exist.

---

## Index names across a collection

An index name is a schema contract within a collection. Reuse the same name across videos and you can retrieve over all of them at once:

```python
coll.semantic_search("a person holding a phone", index_names=["scene"])
coll.query(index_name="objects",
           filter=[{"field": "frames.detections.label", "op": "contains", "value": "car"}])
coll.aggregate(index_name="brands", group_by="brand_names")
```

Indexes sharing a name must have identical field structures — a mismatch fails at create time.

That cuts both ways. When you are iterating on a schema and do **not** want to fan out yet, give each run a unique name (`f"scene_{timestamp}"`) so a changed field layout doesn't collide with the previous attempt.

---

## Inspecting an index

```python
index = video.get_index(name="scene")

for field, schema in index.field_schema.items():
    print(field, schema.type, schema.groups, schema.operators)

page = index.records(limit=20)
for record in page.records:
    print(record.start, record.end, record.data)
```

Paginate with the cursor:

```python
cursor = None
while True:
    page = index.records(limit=100, cursor=cursor)
    for record in page:
        ...
    cursor = page.next_cursor
    if not cursor:
        break
```

`field_schema[...].operators` tells you which filter operators a field actually supports — use it instead of guessing.

---

## Managing runs and indexes

```python
video.list_understandings()
video.get_understanding(understanding_id)
video.delete_understanding(understanding_id)

video.list_indexes()                      # all
video.list_indexes(use_for="semantic")    # single string, not a list
video.get_index(name="scene")
video.get_index(index_id="idx_123")
video.delete_index(index_id)
index.delete()
```

Deleting an index removes its retrieval structures only — the video and the stored artifacts survive.

---

## Scope: video vs collection

Creation is **video-scoped**. `Collection` has no `understand()` and no `index()`; it is the fan-out read scope, exposing `search`, `ask`, `semantic_search`, `query`, and `aggregate` over every indexed video in it.

For live streams, `RTStream` has its own `understand()` and `index()` — see [rtstream-reference.md](rtstream-reference.md).

---

## Cost and latency

Cost scales with the number of model calls, which is scenes × frames per scene.

| Lever | Cheaper | More thorough |
|-------|---------|---------------|
| Segmentation interval | 30–60s scenes | 5s scenes |
| Sampling | 1 frame per scene | 5–8 frames per scene |
| Model tier | `mini` / `basic` | `pro` / `ultra` |
| Transform | `{"resolution": "480p"}` | native resolution |

A 60s interval at 1 frame costs roughly a thirtieth of a 5s interval at 5 frames over the same video. Start coarse, tighten only where retrieval quality demands it. For long videos, pass `callback_url` instead of blocking on `wait_until_complete()`.

Prompt specificity matters more than frame count for retrieval quality. A prompt naming the dimensions you intend to search on ("count people, note clothing colour, note indoor/outdoor") beats "describe this scene" at the same cost.

---

## Gotchas

- **Terminal statuses differ.** `Understanding.is_successful` means `status == "done"`; `Index.is_successful` means `status == "ready"`. Use the properties rather than comparing strings.
- **A run reports `done` only when every analyzer succeeded.** One failed or skipped analyzer makes the run `partial`, which the SDK does not treat as terminal — see the warning under Waiting. Gate on `analyzer.is_successful` before indexing each artifact.
- **Never match on `analyzer.type`.** It echoes the server's internal name, not what you sent: a `spoken_words` analyzer reports `.type == "speech_transcription"`. Match on `analyzer.name`, which is yours.
- **Guard the polling loop against an empty list.** `all([])` is `True`, so `all(a.is_complete for a in ...)` exits immediately if a refresh transiently returns no analyzers — and the next `index()` then fails with `Analyzer ... not done`. Check the list is non-empty first.
- **Indexing is slower than you expect.** A 102-second clip with 5-second segmentation and three analyzers ran well past 30 minutes. `wait_until_complete()` defaults to a 1800-second timeout, which a modest video can exceed — prefer `callback_url` for anything long.
- **`list_analyzers()` reads a local cache** and makes no network call. Call `understanding.refresh()` first if you didn't just wait on it.
- **`get_analyzer()` raises `ValueError`** when the name doesn't match — it does not return `None`.
- **`Understanding` has no `get_output()`.** Use `understanding.get_analyzer_output(name)` or `analyzer.get_output()`.
- **The creator is `video.index()`.** There is no separate `create_index` method.
- **`use_for` arity is asymmetric**: `index(use_for=["semantic", "query"])` takes a list; `list_indexes(use_for="semantic")` takes a single string.
- **`Index` and friends are not top-level exports.** Use `from videodb.index import Index, IndexRecord, RecordPage, FieldSchema`. `IndexCapability`, `FieldGroup`, `Understanding`, and `UnderstandingAnalyzer` are importable from `videodb` directly.
- **The server recognises more field groups than the SDK enum names.** `FieldGroup` lists four; `fts`, `hydrate`, and `return` also exist. Don't assert that `index.fields` only contains the four.
- **Both stages are asynchronous but validation is not.** Malformed `fields` or `source` raise on the call; slow embedding shows up as a status.
