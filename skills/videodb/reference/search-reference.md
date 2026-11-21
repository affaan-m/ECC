# Search & Retrieval Reference (v2)

Code-level details for the v2 retrieval APIs. For the workflow guide, see [search.md](search.md). For building the indexes these read, see [indexing-reference.md](indexing-reference.md).

Requires `videodb>=0.5.0`.

## Contents

- Imports
- Method availability matrix
- Signatures (search, ask, semantic_search, query, aggregate)
- Search router (old_params, new_params, unsupported_params)
- Filter syntax (field/op/value, operators, and/or/not)
- Sorting
- `return_fields`
- `SearchResponse`
- `AskResponse`
- `SearchResult`
- `Shot`
- Aggregate payload shape
- `legacy_search()`
- Server warnings

## Imports

```python
from videodb import SearchResponse, AskResponse, SearchResult
```

All three are exported at package level. `Shot` objects come back inside results; you rarely construct one.

---

## Method availability matrix

| Method | `Video` | `Collection` | `RTStream` | Returns |
|--------|:-------:|:------------:|:----------:|---------|
| `search()` | yes | yes | separate API | `SearchResponse` (v2) or `SearchResult` (legacy-routed) |
| `ask()` | yes | yes | — | `AskResponse` |
| `semantic_search()` | yes | yes | — | `SearchResult` |
| `query()` | yes | yes | — | `SearchResult` |
| `aggregate()` | yes | yes | — | `dict` or `list[dict]` |
| `legacy_search()` | yes | yes | — | `SearchResult` |
| `understand()` / `index()` | yes | **no** | yes | see [indexing-reference.md](indexing-reference.md) |

Video and collection signatures are identical; only the scope differs. Creation is video-scoped, retrieval is available at both levels.

`RTStream.search()` is a different method with its own signature — `search(query, index_id, result_threshold, score_threshold, dynamic_score_percentage, filter)` returning `RTStreamSearchResult`. It has no v2 router and no `ask`/`semantic_search`/`query`/`aggregate`. See [rtstream-reference.md](rtstream-reference.md).

---

## Signatures

```python
video.search(query, *args, config=None, **kwargs)

video.ask(
    question,
    top_k=15,
    mode="default",
    include_sources=False,
)

video.semantic_search(
    query,
    index_names=None,       # str or list[str]
    top_k=10,
    score_threshold=None,
    filter=None,            # list or dict
    return_fields=None,     # list, dict, or str
    index_ids=None,         # str or list[str]
)

video.query(
    index_name=None,
    filter=None,
    limit=100,
    return_fields=None,
    sort=None,              # str or list[(field, direction)]
    index_id=None,
)

video.aggregate(
    index_name=None,
    filter=None,
    group_by=None,
    metric="count",
    limit=100,
    sort=None,
    index_id=None,
)
```

### `search()` v2 keywords

| Keyword | Type | Description |
|---------|------|-------------|
| `top_k` | `int` | Number of results |
| `mode` | `str` | `"default"`, or `"deepsearch"` for multi-step investigation |
| `return_fields` | `list\|dict\|str` | Index rows to hydrate onto each shot |
| `include_clip` | `bool` | Request a playable clip per result. Routed to v2 by the SDK; server support unconfirmed |
| `session_id` | `str` | Continue a deepsearch session |
| `config` | `dict` | Request configuration passthrough |

### `ask()` parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `question` | `str` | required | Question to answer from indexed content |
| `top_k` | `int` | `15` | Evidence passages to consider |
| `mode` | `str` | `"default"` | Retrieval mode |
| `include_sources` | `bool` | `False` | Return timestamped evidence shots |

### `semantic_search()` parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `str` | required | Natural-language query |
| `index_names` | `str\|list\|None` | `None` | Target indexes by name; all semantic indexes if omitted. An entry may address a single field with a dotted path — `"scene.setting.location_type"` |
| `top_k` | `int` | `10` | Results to return |
| `score_threshold` | `float\|None` | `None` | Minimum relevance score |
| `filter` | `list\|dict\|None` | `None` | Structured conditions combined with the vector match |
| `return_fields` | `list\|dict\|str\|None` | `None` | Index rows to hydrate |
| `index_ids` | `str\|list\|None` | `None` | Target indexes by ID |

Singular `index_name` / `index_id` are **not** accepted here — use the plural forms.

### `query()` and `aggregate()` parameters

| Parameter | Applies to | Description |
|-----------|-----------|-------------|
| `index_name` / `index_id` | both | Target exactly one index. One is required |
| `filter` | both | Structured conditions |
| `limit` | both | Maximum rows |
| `sort` | both | Ordering |
| `return_fields` | `query()` | Fields to hydrate |
| `group_by` | `aggregate()` | Field to group on |
| `metric` | `aggregate()` | `count` (default). Forwarded to the indexing service unchanged; other metrics are unconfirmed |

---

## Search router

`search()` inspects its arguments and dispatches to either the v2 endpoint or `legacy_search()`. Three literal sets drive the decision:

```python
old_params = {"search_type", "index_type", "result_threshold", "dynamic_score_percentage",
              "scene_index_id", "index_id", "algorithm", "sort_docs_on", "namespace",
              "stitch", "rerank", "rerank_params"}

new_params = {"top_k", "mode", "return_fields", "include_clip", "session_id", "config"}

unsupported_params = {"index_name", "index_names", "index_ids"}
```

Rules, in order:

| Condition | Result |
|-----------|--------|
| Both legacy and v2 keywords present | `ValueError` — checked first, do not mix |
| Any `unsupported_params` keyword | `ValueError` — `search()` selects indexes automatically |
| Any positional argument | Routes to `legacy_search()` |
| Any `old_params` keyword set to a non-`None` value | Routes to `legacy_search()` |
| Otherwise | Routes to v2 |

The mix check runs before the routing decision, so `video.search(q, "semantic", top_k=5)` raises rather than falling back to legacy.

**`score_threshold` and `filter` appear in none of the three sets.** Passing either alone does *not* route to legacy — the call goes to v2 and the keyword is forwarded there. For v2, prefer `semantic_search(score_threshold=...)`. When you mean the legacy engine, call `legacy_search()` explicitly.

---

## Filter syntax

Filters operate on fields declared in the index's `filter` group. A condition is a dict of `field`, `op`, `value`:

```python
filter={"field": "topic", "op": "==", "value": "hiring"}          # single condition
filter=[{"field": "activity", "op": "==", "value": "conversation"},
        {"field": "setting.location_type", "op": "in", "value": ["home", "office"]}]  # ANDed
```

| Operator | Meaning |
|----------|---------|
| `==` | Exact match |
| `!=` | Not equal |
| `contains` | Substring or array membership |
| `in` | Value is one of a list |
| `exists` | Field is present |

That set was read live off a `string` field: `field_schema["outputs"].operators` returned `['==', '!=', 'contains', 'in', 'exists']`. Numeric and array fields expose different sets, so **read `index.field_schema[field].operators` for the authoritative list** rather than assuming these five apply everywhere.

Boolean composition uses `and`, `or`, and `not` as keys wrapping further conditions:

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

Dotted paths address nested data. When a path crosses a list, the condition matches if **any** element satisfies it.

Discover valid operators per field at runtime rather than guessing:

```python
index = video.get_index(name="objects")
print(index.field_schema["frames.detections.label"].operators)
```

---

## Sorting

```python
sort=[("max_score", "desc")]
sort=[("start", "asc"), ("max_score", "desc")]
```

Only fields in the index's `sort` group can be sorted on.

A bare string is accepted but normalises to **descending** — `sort="start"` becomes `[("start", "desc")]`. Use the tuple form when direction matters.

---

## `return_fields`

Controls which stored index rows are hydrated onto each result, under `shot.metadata["indexes"]`. It does not affect which results match.

| Value | Meaning |
|-------|---------|
| `None` | No hydration (default) |
| `"all"` or `"*"` | Every index — useful for debugging |
| `"scene"` | One index by name or ID |
| `["scene", "objects"]` | Several indexes |
| `{"scene": ["scene_description"], "transcript": ["text"]}` | Specific fields per index |

```python
results = video.semantic_search(
    query="person holding a phone",
    index_names=["scene"],
    return_fields=["scene", "objects"],
)

for shot in results:
    indexes = shot.metadata.get("indexes", {})
    print(indexes.get("scene", []))
    print(indexes.get("objects", []))
```

Fields with no group — nested objects and lists of objects — are stored but never searchable. `return_fields` is the only way to read them back.

---

## `SearchResponse`

Returned by v2 `search()`.

| Property | Type | Description |
|----------|------|-------------|
| `.response_type` | `str` | `"shots"`, `"aggregate"`, or `"deepsearch"` |
| `.results` | `SearchResult\|dict\|list` | `SearchResult` for shots and deepsearch; raw payload for aggregate |
| `.shots` | `list[Shot]` | Convenience accessor |
| `.session_id` | `str\|None` | Deepsearch session to continue |
| `.waiting_for` | `str` | Deepsearch state; `"none"` when not waiting |
| `.clarification` | `dict\|None` | Follow-up question from the planner: `{question_id, text, mode, options}`. The prose is in `["text"]` |
| `.trace` | `dict\|None` | Planner debugging info |
| `.warnings` | `list[dict]` | Server-supplied notices |

| Method | Returns | Description |
|--------|---------|-------------|
| `.get_shots()` | `list[Shot]` | Matching segments |
| `.get_shot_results()` | `SearchResult` | Underlying result; raises `SearchError` for aggregate responses |
| `.compile()` | `str` | Stream URL of all shots concatenated |
| `.play()` | `str` | Open the compiled stream |
| `.get_embed_code(...)` | `str` | Embeddable player markup |

Also iterable, sized, and indexable: `for shot in response`, `len(response)`, `response[0]`.

`SearchResponse` has **no** `.stream_url`, `.player_url`, or `.collection_id`. Those exist on `SearchResult`. Use `.compile()` to get a URL. `compile()`, `play()`, and `get_embed_code()` raise `SearchError` when `response_type == "aggregate"`.

## `AskResponse`

| Property | Type | Description |
|----------|------|-------------|
| `.answer` | `str` | Synthesised answer |
| `.sources` | `list[Shot]` | Evidence shots, when `include_sources=True` |
| `.warnings` | `list[dict]` | Server-supplied notices |

## `SearchResult`

Returned by `semantic_search()`, `query()`, and `legacy_search()`.

| Property | Type | Description |
|----------|------|-------------|
| `.shots` | `list[Shot]` | Matching segments |
| `.stream_url` | `str\|None` | Populated after `compile()` |
| `.player_url` | `str\|None` | Populated after `compile()` |
| `.collection_id` | `str` | Parent collection |
| `.warnings` | `list[dict]` | Server-supplied notices |

| Method | Returns | Description |
|--------|---------|-------------|
| `.get_shots()` | `list[Shot]` | Matching segments |
| `.compile()` | `str` | Stream URL of all shots |
| `.play()` | `str` | Open the compiled stream |
| `.get_embed_code(...)` | `str` | Embeddable player markup |

Iterable, sized, and indexable.

## `Shot`

| Property | Type | Description |
|----------|------|-------------|
| `.video_id` | `str` | Source video |
| `.video_title` | `str` | Source title |
| `.video_length` | `float` | Source duration |
| `.start` | `float` | Start time (seconds) |
| `.end` | `float` | End time (seconds) |
| `.text` | `str` | Matched text |
| `.search_score` | `float` | Relevance |
| `.metadata` | `dict` | Hydrated index rows under `["indexes"]` |
| `.stream_url` | `str\|None` | Direct stream, when available |

| Method | Returns | Description |
|--------|---------|-------------|
| `.generate_stream()` | `str` | Stream URL for this segment |
| `.play()` | `str` | Open in a browser |

---

## Aggregate payload shape

`aggregate()` returns the raw server payload — not a `SearchResult`. There is no `.get_shots()` on it. The declared return type is `Union[Dict, List[Dict]]`, so handle both an envelope dict and a bare list:

```python
agg = coll.aggregate(index_name="brands", group_by="brand_names", metric="count")

rows = agg.get("results", []) if isinstance(agg, dict) else agg
for row in rows:
    print(row)
```

**Observed live, the bare-list form is what came back** — `aggregate(index_name=..., group_by=..., metric="count")` returned a plain `list` of grouped rows with no `results` key at all, e.g. `[{"outputs": "A man in a striped polo shirt...", "count": 1}, ...]`. Do not subscript blindly; the guard above is not defensive padding.

An envelope form is also possible, in which case `warnings` may be present:

```json
{
  "results": [
    {"brand_names": "Nike", "count": 42},
    {"brand_names": "Adidas", "count": 17}
  ],
  "warnings": []
}
```

---

## `legacy_search()`

Reads v1 `spoken_word` and `scene` indexes explicitly, bypassing the router.

```python
video.legacy_search(
    query,
    search_type="semantic",
    index_type="spoken_word",
    result_threshold=None,
    score_threshold=None,
    dynamic_score_percentage=None,
    filter=[],
)
```

`Collection.legacy_search()` additionally accepts `sort_docs_on`, `namespace`, `scene_index_id`, `index_id`, `algorithm`, `stitch`, `rerank`, and `rerank_params`. On `Video` these arrive through `**kwargs` instead. `index_id` is accepted as an alias of `scene_index_id`.

For parameter detail and v1 search behaviour, see [legacy/search.md](legacy/search.md).

---

## Server warnings

Both response envelopes carry `.warnings`, a list of dicts from the server. The SDK re-emits each as a Python `UserWarning`, deduplicated by warning code for the lifetime of the process — so a long-running service sees each notice once. To see them every time:

```python
import warnings
warnings.simplefilter("always")
```
