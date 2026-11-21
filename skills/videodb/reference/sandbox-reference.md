# Sandbox Compute Code Reference

SDK methods, objects, and enums for VideoDB Sandbox Compute. Requires `videodb>=0.5.1`. For the workflow guide see [sandbox.md](sandbox.md).

## Imports

```python
import videodb
from videodb import SandboxTier, SandboxStatus, SandboxModel
from videodb.sandbox import Sandbox
```

## Connection methods

### `conn.create_sandbox(...)`

Create a sandbox (GPU compute pool). Returns immediately with a `Sandbox` in `provisioning` state.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tier` | `str` | server decides | `"small"` or `"medium"` — use `SandboxTier` |
| `name` | `str` | auto-generated | Human-readable name |
| `callback_url` | `str \| None` | `None` | URL for sandbox lifecycle webhooks |
| `model_categories` | `list[str] \| None` | `None` | Categories to prepare, e.g. `["vlm", "image_generation"]` |
| `models` | `list[str] \| None` | `None` | Exact model IDs to prepare |

Provide `models`, `model_categories`, or both. Returns `Sandbox`.

### `conn.get_sandbox(sandbox_id)`

Fetch a sandbox by ID. Returns `Sandbox`.

### `conn.list_sandboxes(status=None, page=1, page_size=20)`

List sandboxes, optionally filtered by `status`. `page_size` max is 100. Returns `list[Sandbox]`.

## `Sandbox` object

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `str` | Public sandbox ID (`bx-...`) |
| `tier` | `str` | `"small"` or `"medium"` |
| `status` | `str` | See `SandboxStatus` |
| `name` | `str` | Sandbox name |
| `models` | `list[str]` | Requested model IDs |
| `model_categories` | `list[str]` | Requested categories |
| `region` | `str` | Placement region |
| `created_at` / `started_at` / `stopped_at` / `expires_at` | `str` | Lifecycle timestamps |
| `is_active` | `bool` | `True` when status is `active` |
| `is_ready` | `bool` | `True` when status is `active` or `alert` |

### Methods

| Method | Description |
|--------|-------------|
| `refresh()` | Fetch latest state from the server; returns `self` |
| `wait_for_ready(timeout=300, interval=5)` | Poll until `active`/`alert`; raises `InvalidRequestError` on terminal state, `RequestTimeoutError` on timeout; returns `self` |
| `stop(grace=True)` | Stop the sandbox (`grace=True` lets running jobs finish); returns `self` |
| `wait_for_stop(timeout=120, interval=5)` | Poll until `stopped`/`failed`; raises `RequestTimeoutError` on timeout; returns `self` |

## Enums and constants

### `SandboxTier`

```python
SandboxTier.small    # "small"
SandboxTier.medium   # "medium"
```

### `SandboxStatus`

```python
SandboxStatus.provisioning
SandboxStatus.active
SandboxStatus.stopping
SandboxStatus.stopped
SandboxStatus.failed
SandboxStatus.alert
```

Ready statuses: `active`, `alert`. Terminal statuses: `stopped`, `failed`.

### `SandboxModel`

Convenience enum of supported model IDs (a `str` enum — `SandboxModel.FLUX == "black-forest-labs/FLUX.1-dev"`). Use `.value` when passing to `models=[...]`, or pass the plain string.

| Enum | Value | Use case | Min tier |
|------|-------|----------|----------|
| `GEMMA_4_E2B` | `google/gemma-4-E2B-it` | text generation | small |
| `QWEN_4B` | `Qwen/Qwen3-4B` | text generation | small |
| `QWEN_9B` | `Qwen/Qwen3.5-9B` | text and vision | small |
| `WHISPER_LARGE_V3_TURBO` | `openai/whisper-large-v3-turbo` | speech-to-text | small |
| `OMNIVOICE` | `k2-fsa/OmniVoice` | text-to-speech | small |
| `STABLE_AUDIO_OPEN` | `stabilityai/stable-audio-open-1.0` | audio generation | small |
| `RTDETR_V2_R50VD` | `rtdetr-v2-r50vd` | object detection | small |
| `GEMMA_4_26B` | `google/gemma-4-26B-A4B-it` | text and vision | medium |
| `QWEN_27B` | `Qwen/Qwen3.5-27B` | text and vision | medium |
| `GEMMA_4_31B` | `google/gemma-4-31B-it` | text and vision | medium |
| `FLUX` | `black-forest-labs/FLUX.1-dev` | image generation | medium |

IDs carry **no `-FP8`/quantization suffix**. Passing a suffixed ID fails validation.

## Sandbox-aware generation methods

Existing `Collection` generation methods gain `model_name` + `sandbox_id`. When a sandbox job is created, they return a `GenerationJob`; call `.wait(timeout=..., interval=...)` for the asset.

| Method | Sandbox params | Returns |
|--------|----------------|---------|
| `coll.generate_text(prompt, model_name, sandbox_id, max_tokens, temperature, response_type, model_config, wait=True)` | `model_name`, `sandbox_id` | `str \| dict` (synchronous) |
| `coll.generate_image(prompt, model_name, sandbox_id, config, wait=False)` | `model_name`, `sandbox_id` | `Image \| GenerationJob` |
| `coll.generate_voice(text, model_name, sandbox_id, config, voice_clone_id, wait=False)` | `model_name`, `sandbox_id`, `voice_clone_id` | `Audio \| GenerationJob` |
| `coll.create_voice_clone(ref_audio_id, name, description, ref_text, language)` | — | `VoiceClone` |

`generate_music()` and `generate_sound_effect()` do **not** accept `sandbox_id`/`model_name` yet.

## Understanding analyzers with a sandbox

`video.understand(analyzers=[...])` — set `config.model` and `config.sandbox_id` inside each analyzer:

```python
video.understand(
    analyzers=[
        {
            "type": "vlm",                      # or "object_detection", etc.
            "name": "scene",
            "config": {
                "model": "google/gemma-4-31B-it",
                "sandbox_id": sandbox.id,
                "prompt": "...",                # vlm only
                "schema": {...},                # vlm only, optional
            },
        }
    ],
)
```

See [indexing-reference.md](indexing-reference.md) for the full `understand`/`index` surface.

## Exceptions

| Exception | Raised when |
|-----------|-------------|
| `videodb.exceptions.InvalidRequestError` | Unsupported model, tier mismatch, concurrent-limit reached, terminal sandbox state during `wait_for_ready` |
| `videodb.exceptions.RequestTimeoutError` | `wait_for_ready` / `wait_for_stop` timeout elapses |
| `videodb.exceptions.AuthenticationError` | Missing/invalid `VIDEO_DB_API_KEY` |
