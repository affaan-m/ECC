# Search & Retrieval Guide (v2)

Five ways to read indexed video, all available on both `Video` and `Collection` with identical signatures.

Requires a v2 index — see [indexing.md](indexing.md) for building one. For exact signatures and the filter DSL, see [search-reference.md](search-reference.md). For the v1 engine, see [legacy/search.md](legacy/search.md).

Requires `videodb>=0.5.0`.

A runnable end-to-end notebook covering all five methods is in the [indexing-v2 cookbook](https://github.com/video-db/videodb-cookbook/tree/preview/guides/indexing-v2/search).

## Contents

- Choosing a method (decision table)
- `search()`
- Deepsearch sessions
- `ask()`
- `semantic_search()`
- `query()`
- `aggregate()`
- Hydrating results with `return_fields`
- From results to playable streams
- Collection scope
- Legacy routing (which keywords route where)
- Tips

## Choosing a method

| Goal | Method | Returns |
|------|--------|---------|
| Find moments, let VideoDB pick the indexes | `search(query)` | `SearchResponse` |
| Multi-step investigation with follow-ups | `search(query, mode="deepsearch")` | `SearchResponse` + `session_id` |
| A written answer, with evidence | `ask(question, include_sources=True)` | `AskResponse` |
| Semantic search against a named index | `semantic_search(query, index_names=[...])` | `SearchResult` |
| Exact structured filtering | `query(index_name=..., filter=[...])` | `SearchResult` |
| Counts, groups, facets | `aggregate(index_name=..., group_by=...)` | `dict` or `list[dict]` |
| Existing v1 `spoken_word` / `scene` indexes | `legacy_search(...)` | `SearchResult` |

Start with `search()`. Reach for the others when you need to target a specific index, filter exactly, count, or answer a question in prose.

---

## `search()`

Natural-language retrieval. VideoDB plans the retrieval and chooses which indexes to read.

```python
response = coll.search("moments where customers object to pricing")

for shot in response.shots:
    print(f"{shot.video_id} [{shot.start:.1f}s - {shot.end:.1f}s] {shot.text}")

if response.response_type in ("shots", "deepsearch") and len(response):
    print(response.compile())
```

`compile()` needs shots. It raises `SearchError` both on an empty response and on an `aggregate` response, so check `response_type` as well as length.

| Keyword | Description |
|---------|-------------|
| `top_k` | Number of results |
| `mode` | `"default"`, or `"deepsearch"` |
| `return_fields` | Index rows to hydrate onto each shot |
| `include_clip` | Request a playable clip per result (accepted by the SDK; support unconfirmed) |
| `session_id` | Continue a deepsearch session |
| `config` | Request configuration passthrough |

`search()` deliberately refuses index selectors. Passing `index_name`, `index_names`, or `index_ids` raises `ValueError` — use `semantic_search()` when you need to choose.

`response.response_type` is `"shots"` for moments and `"aggregate"` when the planner decided the question was analytical:

```python
if response.response_type == "shots":
    stream_url = response.compile()
else:
    for row in response.results:      # already the row list, not an envelope
        print(row)
```

> **Return type changed in 0.5.0.** `search()` used to return `SearchResult`; it now returns `SearchResponse`. Iteration, `len()`, `get_shots()`, `compile()`, and `play()` all still work. But `SearchResponse` has **no** `.stream_url`, `.player_url`, or `.collection_id` — code doing `r = video.search(q); print(r.stream_url)` raises `AttributeError`. Call `r.compile()` instead.

---

## Deepsearch sessions

`mode="deepsearch"` runs a multi-step investigation and can ask you for clarification. Carry `session_id` forward to refine.

```python
response = coll.search(
    "find the strongest examples of customers objecting to pricing",
    mode="deepsearch",
    top_k=10,
)

if response.clarification:
    print(response.clarification["text"])   # a dict: question_id, text, mode, options

followup = coll.search(
    "focus on the enterprise plan, Q4 interviews only",
    mode="deepsearch",
    session_id=response.session_id,
)
```

Deepsearch does not accept filters, sorting, score thresholds, or index selectors.

---

## `ask()`

Retrieves evidence and synthesises an answer grounded in it.

```python
answer = coll.ask(
    "What objections do customers raise about pricing?",
    top_k=15,
    include_sources=True,
)

print(answer.answer)

for source in answer.sources:
    print(source.video_id, source.start, source.end)
    print(source.generate_stream())
```

`ask()` reads v2 indexes only — it does not fall back to v1 indexes.

---

## `semantic_search()`

Vector search against indexes you name. Use this instead of `search()` when you know which index answers the question, or when you need `score_threshold`.

```python
results = video.semantic_search(
    query="a customer reacting positively to a product",
    index_names=["scene"],
    top_k=10,
    score_threshold=0.7,
)

for shot in results:
    print(shot.start, shot.end, shot.search_score)
```

Omit `index_names` to search every semantic index in scope. Target by ID with `index_ids` instead. The singular forms `index_name` and `index_id` are not accepted here.

**Target a single field, not just an index**, by appending a dotted path to the index name. This is the sharpest tool in the retrieval API — it searches one field's embeddings instead of the whole record:

```python
video.semantic_search(query="inside a home", index_names=["scene.setting.location_type"])
video.semantic_search(query="a device connected by a cable",
                      index_names=["scene.object_descriptions.description"])
```

`filter` combines structured conditions with the vector match:

```python
results = video.semantic_search(
    query="people talking",
    index_names=["scene"],
    filter=[{"field": "setting.environment", "op": "==", "value": "indoor"}],
)
```

---

## `query()`

Exact conditions, no natural-language interpretation. Requires exactly one index.

```python
results = coll.query(
    index_name="objects",
    filter=[{"field": "frames.detections.label", "op": "contains", "value": "cell phone"}],
    limit=100,
    sort=[("max_score", "desc")],
)

for shot in results.get_shots():
    print(shot.start, shot.end)
```

Filters read fields declared in the index's `filter` group. A condition is `{"field": ..., "op": ..., "value": ...}`. A list of them is ANDed:

```python
filter=[
    {"field": "activity", "op": "==", "value": "conversation"},
    {"field": "setting.location_type", "op": "in", "value": ["home", "office"]},
]
```

Operators on a string field, read live from `field_schema`: `==`, `!=`, `contains`, `in`, `exists`. Numeric and array fields differ — check `index.field_schema[field].operators` rather than assuming. Dotted paths address nested data, and a condition matches when **any** element along a list path satisfies it.

Conditions compose with `and`, `or`, and `not`:

```python
filter={
    "and": [
        {"or": [
            {"field": "activity", "op": "==", "value": "using_device"},
            {"field": "activity", "op": "==", "value": "object_interaction"},
        ]},
        {"not": {"field": "setting.environment", "op": "==", "value": "outdoor"}},
    ]
}
```

Discover what a field supports rather than guessing:

```python
index = video.get_index(name="objects")
print(index.field_schema["frames.detections.label"].operators)
```

`query()` needs stored rows but not embeddings, so it works on a `building` index once the ingest has landed. Immediately after `index()` returns there may be no rows yet — wait for `ready` if you need results straight away.

---

## `aggregate()`

Counts, grouping, and facets over indexed records.

```python
agg = coll.aggregate(
    index_name="objects",
    group_by="frames.detections.label",
    metric="count",
    limit=100,
)

# The payload is returned as-is and may be an envelope dict or a bare list.
rows = agg.get("results", []) if isinstance(agg, dict) else agg
for row in rows:
    print(row)
```

`count` is the default and the only metric confirmed in use. Other aggregate metrics may be available — `metric` is forwarded to the indexing service unchanged — but verify before relying on one.

> **Check the counting unit when `group_by` crosses a list.** Dotted paths collect values from every element of a list, so it is not obvious whether grouping on something like `frames.detections.label` counts *scenes containing* the label or *detections of* it — and the two differ by an order of magnitude for an object visible across many frames. Unverified either way; confirm against a known clip before reporting the number. Grouping on a top-level field such as `activity` has no such ambiguity.

> `aggregate()` returns the **raw server payload** typed as `dict | list[dict]`, not a `SearchResult`. There is no `.get_shots()` or `.compile()` on it, and no guarantee of a `results` key — guard with `isinstance` as above rather than subscripting blindly.

This has no v1 equivalent. Questions like "how many shots show a car" previously required fetching every scene description and counting client-side.

---

## Hydrating results with `return_fields`

`return_fields` attaches stored index rows to each result under `shot.metadata["indexes"]`. It changes what you can read off a result, not which results match.

```python
response = coll.search(
    "person talking about Nike while holding a phone",
    top_k=10,
    return_fields={
        "scene": ["scene_description", "frames"],
        "transcript": ["text"],
        "brands": ["brand_names"],
    },
)

for shot in response:
    indexes = shot.metadata.get("indexes", {})
    print(indexes.get("scene", []))
    print(indexes.get("brands", []))
```

Accepted values: `None` (default), `"all"` or `"*"`, a single index name or ID, a list of them, or a dict of index → field list.

Fields that carry no group — nested objects and lists of objects — are stored but never searchable. `return_fields` is the only way to read them back.

---

## From results to playable streams

```python
# Every match, concatenated
stream_url = video.semantic_search("product demo", index_names=["scene"]).compile()

# From a SearchResponse
stream_url = video.search("product demo").compile()

# One moment
shot = response.shots[0]
print(shot.generate_stream())
shot.play()

# Hand-picked ranges
timestamps = [(s.start, s.end) for s in response.shots[:3]]
stream_url = video.generate_stream(timestamps)
```

Streams are HLS URLs. Make one playable in a browser with `https://console.videodb.io/player?url={stream_url}`.

---

## Collection scope

Every method above exists on `Collection` with the same signature, fanning out across every indexed video in it:

```python
coll.search("pricing objections")
coll.ask("What do customers say about onboarding?")
coll.semantic_search("a person holding a phone", index_names=["scene"])
coll.query(index_name="brands",
           filter=[{"field": "brand_names", "op": "==", "value": "Nike"}])
coll.aggregate(index_name="brands", group_by="brand_names")
```

Fan-out works because indexes sharing a name across videos form one logical index. Give the same `name` to the same artifact type on every video — and note that indexes sharing a name must have identical field structures.

Creating indexes is video-scoped: `Collection` has no `understand()` or `index()`.

---

## Legacy routing

`search()` picks its engine by inspecting your arguments.

| You pass | Engine |
|----------|--------|
| Nothing beyond `query`, or any of `top_k` / `mode` / `return_fields` / `include_clip` / `session_id` / `config` | v2 |
| Any of `search_type` / `index_type` / `result_threshold` / `dynamic_score_percentage` / `scene_index_id` / `index_id` / `algorithm` / `sort_docs_on` / `namespace` / `stitch` / `rerank` / `rerank_params` | legacy |
| Any positional argument | legacy |
| Both kinds together | `ValueError` |
| `index_name` / `index_names` / `index_ids` | `ValueError` — use `semantic_search()` |

> **`score_threshold` and `filter` are in neither set.** `video.search(query, score_threshold=0.3)` routes to **v2**, not legacy — even though that was a v1 pattern. For v2 use `semantic_search(score_threshold=...)`; for v1 call `legacy_search(...)` explicitly.

---

## Tips

- **Index once, retrieve many times.** Indexing is the expensive step; retrieval is cheap.
- **`query()` and `aggregate()` work on a `building` index once its rows have landed.** Only semantic retrieval needs `ready`. A freshly created index may briefly have no rows at all.
- **Empty results are empty, not an exception.** v2 returns a response with no shots — but `compile()` on that empty response raises `SearchError`, so guard with `if len(response):`. Only `legacy_search()` raises `InvalidRequestError: No results found`.
- **Prefer `semantic_search()` when you know the index.** It is more predictable than letting `search()` plan, and it is the only place `score_threshold` applies.
- **Descriptive queries beat keywords** for semantic retrieval. Save exact terms for `query()` filters.
- **Check `response.warnings`.** The server uses it to flag migration issues. The SDK re-emits each as a `UserWarning`, deduplicated per process — call `warnings.simplefilter("always")` to see every occurrence.
