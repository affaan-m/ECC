# Understanding & Index Reference (v2)

Code-level details for the v2 understanding and indexing APIs. For the workflow guide, see [indexing.md](indexing.md). For retrieval, see [search-reference.md](search-reference.md).

Requires `videodb>=0.5.0`.

## Contents

- Imports
- Video methods (understand, index, get, list, delete)
- `understand()` parameters
- Analyzer spec (9 types, artifact names, per-type config, schema syntax)
- Segmentation, sampling, transform
- `Understanding`
- `UnderstandingAnalyzer`
- `index()` parameters
- Field groups and capabilities (IndexCapability, FieldGroup, field value types)
- `Index`
- `FieldSchema`
- `IndexRecord`
- `RecordPage`
- Custom temporal records
- Status vocabularies
- Errors (synchronous validation messages, ValueError, TimeoutError)

## Imports

```python
from videodb import IndexCapability, FieldGroup, Understanding, UnderstandingAnalyzer

# Not exported at package level — import from the submodule:
from videodb.index import Index, IndexRecord, RecordPage, FieldSchema
```

---

## Video methods

### Understanding

| Method | Returns | Description |
|--------|---------|-------------|
| `video.understand(analyzers, segmentation, sampling, transform, audio_chunking, callback_url)` | `Understanding` | Start an understanding run |
| `video.get_understanding(understanding_id)` | `Understanding` | Reopen a previous run |
| `video.list_understandings()` | `list[Understanding]` | All runs for this video |
| `video.delete_understanding(understanding_id)` | `None` | Delete a run and its artifacts |

### Indexing

| Method | Returns | Description |
|--------|---------|-------------|
| `video.index(source, name, use_for, fields, callback_url)` | `Index\|None` | Create an index from an artifact or records |
| `video.get_index(index_id=None, name=None)` | `Index\|None` | Fetch one index — pass exactly one selector |
| `video.list_indexes(use_for=None)` | `list[Index]` | All indexes, optionally filtered by capability |
| `video.delete_index(index_id)` | `None` | Delete an index |

`Collection` has **no** `understand()` or `index()`. Index creation is video-scoped (and rtstream-scoped); collections are the read scope.

---

## `understand()` parameters

```python
video.understand(
    analyzers=[{"type": "spoken_words"}],
    segmentation=None,
    sampling=None,
    transform=None,
    audio_chunking=None,
    callback_url=None,
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `analyzers` | `list[dict]` | required | Analyzer definitions. Non-empty; each needs a `type` |
| `segmentation` | `dict\|None` | `None` | Run-level scene splitting |
| `sampling` | `dict\|None` | `None` | Run-level frame sampling default |
| `transform` | `dict\|None` | `None` | Run-level preprocessing, e.g. `{"resolution": "480p"}` |
| `audio_chunking` | `dict\|None` | `None` | Run-level audio segmentation |
| `callback_url` | `str\|None` | `None` | Called when the run completes |

Returns immediately with a non-terminal status. Extra keyword arguments are forwarded to the API unchanged.

---

## Analyzer spec

Each entry in `analyzers`:

| Key | Type | Description |
|-----|------|-------------|
| `type` | `str` | Required. Analyzer type — a plain string, no SDK enum |
| `name` | `str` | Analyzer name. Omitted, the server generates `{type}-{random}` (e.g. `vlm-3f2a91bc`) and that is what `analyzer.name` returns — so `index(name=analyzer.name)` would inherit it. Index names themselves still default correctly from the artifact type when you omit `name` on `index()` |
| `inputs` | `list[str]` | Names of earlier artifacts to feed into this analyzer |
| `sampling` | `dict` | Frame selection for this analyzer |
| `config` | `dict` | Model, prompt, schema — type-specific |

### Types and default artifact names

| `type` | Artifact | Emitted fields |
|--------|----------|----------------|
| `spoken_words` | `transcript` | `text`, `chunks`, `words`, `language`, `speaker` |
| `vlm` | `scene` | `scene_description`, `action`, `activity`, `location`, `setting`, `shot_type`, `emotion`, `topic`, `song_detection`, `character_description`, `object_description`, `brand_names`, `outputs`, `full_text` |
| `object_detection` | `objects` | `summary`, `frames`, `detections`, `objects` |
| `ocr` | `ocr` | `combined_text`, `text`, `words`, `language` |
| `brand_detection` | `brands` | `brand_names`, `brands`, `summary`, `detections` |
| `activity_recognition` | `activity` | `labels`, `activity`, `actions`, `detections` |
| `location_detection` | `location` | `location_type`, `setting`, `time_of_day`, `location` |
| `faces` | `faces` | `identities`, `detections`, `faces` |
| `audio_event_detection` | `audio_events` | `events`, `labels`, `audio_events` |

> **`analyzer.type` does not echo back what you sent.** Verified live: submitting `{"type": "spoken_words"}` produces an analyzer whose `.type` reads `speech_transcription` — the server's internal name. So **never match on `analyzer.type`**; `[a for a in analyzers if a.type == "spoken_words"]` returns nothing. Match on `analyzer.name`, which is the value you set.

### Per-type `config`

**`spoken_words`**

```python
{"type": "spoken_words", "config": {"language": "en"}}
```

**`vlm`**

```python
{
    "type": "vlm",
    "config": {
        "model": "pro",               # mini | basic | pro | ultra, or a provider model
        "prompt": "Describe the scene.",
        "schema": {"scene_description": "text", "is_slide": "boolean"},
        "schema_mode": "auto",        # auto | native_required | prompt_only
        "schema_max_retries": 1,
    },
}
```

| `config` key | Description |
|--------------|-------------|
| `model` | Managed alias `mini`, `basic`, `pro`, `ultra`, or a provider model such as `google/gemini-2.5-flash` |
| `sandbox_id` | Required for sandbox-hosted models; not used by managed models |
| `prompt` | Instructions. May interpolate earlier artifacts with `{{inputs.<name>}}` |
| `schema` | Structured output definition (below) |
| `schema_mode` | `auto` (default), `native_required`, or `prompt_only` |
| `schema_max_retries` | Retries when output fails schema validation |

### Schema syntax

| Form | Example |
|------|---------|
| Type name | `"scene_description": "text"` — also `string`, `number`, `boolean` |
| Array shorthand | `"visible_objects": ["string"]` |
| Constrained number | `"confidence": {"type": "number", "min": 0, "max": 1}` |
| Enum | `"activity": {"type": "enum", "values": ["talking", "walking"]}` |
| Optional, documented | `"setting": {"type": "string", "required": False, "description": "..."}` |
| Nested object | `"setting": {"type": "object", "fields": {...}}` |
| Array of objects | `"people": {"type": "array", "min_items": 0, "max_items": 5, "items": {...}}` |

Prefer `text` for prose you intend to search semantically and `enum` for anything you intend to filter or group on — a constrained vocabulary makes `aggregate(group_by=...)` produce clean buckets. Nested fields are addressed downstream with dotted paths (`setting.location_type`).

`config` is forwarded to the server untyped, so a bad value fails server-side rather than at the call.

**`object_detection`**

```python
{"type": "object_detection", "config": {"model": "rtdetr-v2-r50vd"}}
```

**`ocr`, `brand_detection`, `activity_recognition`, `location_detection`** accept `model` only.

---

## Segmentation, sampling, transform

### Segmentation

| Config | Behaviour |
|--------|-----------|
| `{"type": "time", "seconds": 5}` | Fixed-length scenes |
| `{"type": "shot", "threshold": 30}` | Cut-detected scenes. Higher threshold, fewer cuts |

### Sampling

| Config | Behaviour |
|--------|-----------|
| `{"strategy": "uniform", "frame_count": 8}` | N frames spread across each scene |
| `{"strategy": "interval", "every": 1}` | One frame every N seconds |

### Transform

| Config | Behaviour |
|--------|-----------|
| `{"resolution": "480p"}` | Downscale before analysis — cheaper and faster |

---

## `Understanding`

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `.id` | `str` | Run ID |
| `.video_id` | `str` | Parent video |
| `.collection_id` | `str` | Parent collection |
| `.status` | `str` | `queued`, `running`, `done`, `partial`, `failed` |
| `.analyzers` | `list[UnderstandingAnalyzer]` | Analyzers in this run |
| `.output_url` | `str\|None` | Bulk output location. Only set on the create response; `None` after any `refresh()` |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `.is_complete` | `bool` | Status is `done` or `failed`. **Never true for `partial`** |
| `.is_successful` | `bool` | Status is `done` — that is, every analyzer succeeded |
| `.refresh()` | `Understanding` | Re-fetch state from the server |
| `.wait_until_complete(timeout=1800, poll_interval=10)` | `Understanding` | Poll to `done`/`failed`; raises `TimeoutError`. A `partial` run polls until timeout |
| `.list_analyzers()` | `list[UnderstandingAnalyzer]` | **Local cache** — no network call |
| `.get_analyzer(name_or_id, refresh=False)` | `UnderstandingAnalyzer` | Raises `ValueError` if not found |
| `.get_analyzer_output(name_or_id)` | `Any` | Fetch one analyzer's output |
| `.delete()` | `None` | Delete the run and its artifacts |

There is no `Understanding.get_output()`.

---

## `UnderstandingAnalyzer`

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `.id` | `str` | Analyzer ID |
| `.name` | `str` | Artifact name |
| `.type` | `str` | Analyzer type |
| `.status` | `str` | `pending`, `running`, `done`, `failed`, `skipped`, `cancelled` |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `.is_complete` | `bool` | Status in `done`, `failed`, `skipped`, `cancelled` |
| `.is_successful` | `bool` | Status is `done` |
| `.refresh()` | `UnderstandingAnalyzer` | Re-fetch this analyzer's state |
| `.wait_until_complete(timeout=1800, poll_interval=10)` | `UnderstandingAnalyzer` | Raises `TimeoutError` |
| `.get_output()` | `Any` | The analyzer's segment output |
| `.to_index_source()` | `dict` | Serialise as an index `source` reference |

`to_index_source()` returns `{"understanding_id": ..., "analyzer_id": ..., "analyzer_type": ...}` — identifiers only, so the server re-reads the artifact from its own store. Passing the analyzer object to `video.index(source=...)` calls this for you.

---

## `index()` parameters

```python
video.index(
    source=analyzer,
    name=None,
    use_for=None,
    fields=None,
    callback_url=None,
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `source` | `UnderstandingAnalyzer\|dict\|list` | required | See below |
| `name` | `str\|None` | artifact name | Index name — the schema contract within a collection |
| `use_for` | `list[str]\|None` | all three | Subset of `semantic`, `query`, `aggregate` |
| `fields` | `dict\|None` | derived | Field group → field name list |
| `callback_url` | `str\|None` | `None` | Called when the build completes |

### Source forms

| Form | Example | Notes |
|------|---------|-------|
| Analyzer object | `source=analyzer` | Preferred. Anything with `to_index_source()` |
| Reference dict | `source={"understanding_id": "und_1", "analyzer_id": "an_2"}` | Must carry `understanding_id` |
| Records dict | `source={"scenes": [...]}` | Must carry a `scenes` list |
| Records list | `source=[{"start": 0, "end": 5, ...}]` | Sugar for `{"scenes": [...]}` |

Rejections:

| Input | Error |
|-------|-------|
| `None` | `ValueError: source is required` |
| dict with neither key | `ValueError: source dict must carry 'scenes' (temporal records) or an 'understanding_id' reference` |
| any other type | `ValueError: source must be an analyzer object, a dict with 'scenes' or 'understanding_id', or a list of temporal records` |

---

## Field groups and capabilities

### `IndexCapability` — values for `use_for`

| Value | Unlocks |
|-------|---------|
| `IndexCapability.semantic` | `semantic_search()` and `search()` |
| `IndexCapability.query` | `query()` |
| `IndexCapability.aggregate` | `aggregate()` |

The server also accepts `search` as an alias of `semantic`.

### `FieldGroup` — keys for `fields`

| Value | Purpose |
|-------|---------|
| `FieldGroup.semantic` | Vector search |
| `FieldGroup.filter` | `query()` conditions |
| `FieldGroup.aggregate` | Grouping and faceting |
| `FieldGroup.sort` | Result ordering |

The server additionally recognises `fts` (full-text, auto-applied to `text` and `combined_text`), plus `hydrate` and `return`, which are explicit-only. These are not named in the SDK enum.

### Field value types

| Type | Example | Typical groups |
|------|---------|----------------|
| `string` | `"Nike"` | filter, aggregate |
| `text` | `"A person walks through a store."` | semantic, fts |
| `number` | `0.94` | filter, sort, aggregate |
| `boolean` | `True` | filter, aggregate |
| `string_array` | `["person", "phone"]` | filter (contains), aggregate |
| `number_array` | `[0.91, 0.88]` | filter, aggregate |
| `object` | `{...}` | none by default — index inner values with dotted paths |

---

## `Index`

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `.index_id` | `str` | Index ID |
| `.video_id` | `str` | Parent video |
| `.collection_id` | `str` | Parent collection |
| `.name` | `str` | Index name |
| `.status` | `str` | `building`, `ready`, `failed` |
| `.use_for` | `list` | Effective capabilities after any degradation |
| `.source` | `dict` | The artifact reference or records it was built from |
| `.record_count` | `int` | Number of records |
| `.fields` | `dict` | Resolved group → field names |
| `.field_schema` | `dict[str, FieldSchema]` | Per-field type, groups, operators |
| `.error` | `str\|None` | Failure reason when `status == "failed"` |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `.is_complete` | `bool` | Status is `ready` or `failed` |
| `.is_successful` | `bool` | Status is `ready` |
| `.refresh()` | `Index` | Re-fetch the manifest |
| `.wait_until_complete(timeout=1800, poll_interval=10)` | `Index` | Raises `TimeoutError` |
| `.records(limit=20, cursor=None)` | `RecordPage` | Preview stored records |
| `.delete()` | `None` | Delete retrieval structures; video and artifacts survive |

### Status semantics

| Status | `query()` / `aggregate()` | `semantic_search()` |
|--------|--------------------------|---------------------|
| `building` | works | not yet |
| `ready` | works | works |
| `failed` | no | no |

---

## `FieldSchema`

| Property | Type | Description |
|----------|------|-------------|
| `.type` | `str` | `string`, `string_array`, `number`, `text`, `boolean` |
| `.groups` | `list[str]` | Groups this field belongs to |
| `.operators` | `list[str]` | Filter operators the field supports |

Read `.operators` to discover valid `query()` conditions at runtime instead of guessing.

## `IndexRecord`

| Property | Type | Description |
|----------|------|-------------|
| `.video_id` | `str` | Source video |
| `.understanding_id` | `str` | Run that produced it |
| `.scene_id` | `str` | Scene identifier |
| `.start` | `float` | Start time (seconds) |
| `.end` | `float` | End time (seconds) |
| `.data` | `dict` | Indexed field values |
| `.metadata` | `dict` | Per-scene metadata (present in the raw payload alongside `scene_id`) |

`.segment_id`, `.start_sec`, and `.end_sec` are deprecated aliases of `.scene_id`, `.start`, and `.end`. Both spellings are populated, so older code keeps working.

## `RecordPage`

| Property | Type | Description |
|----------|------|-------------|
| `.records` | `list[IndexRecord]` | Records in this page |
| `.next_cursor` | `str\|None` | Cursor for the next page; `None` when exhausted |

Iterable and indexable directly:

```python
cursor = None
while True:
    page = index.records(limit=100, cursor=cursor)
    for record in page:
        print(record.start, record.data)
    cursor = page.next_cursor
    if not cursor:
        break
```

---

## Custom temporal records

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `start` | `number` | yes | Start time in seconds |
| `end` | `number` | yes | End time in seconds; must exceed `start` |
| `scene_id` | `str` | no | Stable identifier; generated if omitted |
| `metadata` | `dict` | no | Extra metadata |
| *any other key* | — | no | Indexable custom data |

```python
detections = [
    {"start": 0.0, "end": 4.0, "label": "intro", "confidence": 0.98},
    {"start": 4.0, "end": 19.5, "label": "demo", "confidence": 0.91},
]

index = video.index(
    name="segments",
    source=detections,
    use_for=["query", "aggregate"],
    fields={"filter": ["label", "confidence"], "aggregate": ["label"], "sort": ["confidence"]},
)
```

---

## Status vocabularies

| Object | All statuses | SDK treats as terminal | `is_successful` when |
|--------|--------------|------------------------|----------------------|
| `Understanding` | `queued`, `running`, `done`, `partial`, `failed` | `done`, `failed` | `done` |
| `UnderstandingAnalyzer` | `pending`, `running`, `done`, `failed`, `skipped`, `cancelled` | `done`, `failed`, `skipped`, `cancelled` | `done` |
| `Index` | `building`, `ready`, `failed` | `ready`, `failed` | `ready` |

The three vocabularies differ. Prefer `is_complete` / `is_successful` over comparing status strings.

**`partial` is not in the SDK's terminal set.** A run where one analyzer fails or is skipped ends `partial`, so `Understanding.wait_until_complete()` polls until it raises `TimeoutError`. Poll the analyzers instead when partial success is expected — see [indexing.md](indexing.md).

---

## Errors

### Synchronous validation on `index()`

These raise on the call itself, before any async work starts.

| Condition | Message |
|-----------|---------|
| Source resolves to nothing | `source resolved to no scenes — nothing to index` |
| Non-dict records | `scenes must be objects; invalid at positions [...]` |
| Bad capability | `invalid use_for value: 'x' (allowed: ['aggregate', 'query', 'search', 'semantic'])` |
| `fields` not a dict | `fields must be an object of {group: [field, ...]}` |
| Unknown group | `unknown fields group: 'x' (allowed: ['aggregate', 'filter', 'fts', 'hydrate', 'return', 'semantic', 'sort'])` |
| Group value not a list of strings | `fields.{group} must be a list of field names` |
| Field not present in any record | `fields.{group} names not present in any scene's data ... Available top-level fields: [...]` |
| Semantic requested, opted out | `use_for includes semantic but fields.semantic is [] (an explicit opt-out)` |
| Semantic requested, no text | `use_for includes semantic but no scene has embeddable text. Available fields: [...]` |
| Name reused with a different shape | Name is a schema contract within the collection — structures must match |

The "not present in any scene's data" error lists the field names that do exist. Read it rather than guessing again.

### Other exceptions

| Exception | Cause |
|-----------|-------|
| `ValueError` | Empty `analyzers`; duplicate analyzer `name`; missing analyzer `type`; unsupported `source`; `get_index()` with neither `index_id` nor `name`; `get_analyzer()` name not found |
| `TimeoutError` | `wait_until_complete()` exceeded its timeout on an `Understanding`, `UnderstandingAnalyzer`, or `Index` |
| `InvalidRequestError` | Server rejected the request |
