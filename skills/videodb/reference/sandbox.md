# Sandbox Compute Guide

Sandbox Compute is VideoDB's managed runtime for supported open-weight and specialized models (Gemma, Qwen, Whisper, OmniVoice, FLUX, RT-DETR, and more).

The pattern is always the same: **create a sandbox → wait until it is active → pass `sandbox_id` to a supported job.** When `sandbox_id` is present, VideoDB routes that job to your sandbox runtime instead of the default hosted path. Omit `sandbox_id` and you get the hosted/default model.

Sandbox is not only an indexing feature. The same sandbox can power understanding analyzers, indexing pipelines, and generation workflows (text-to-speech, image generation, text generation).

> **Requires `videodb>=0.5.1`.** The sandbox interface (`conn.create_sandbox`, `Sandbox`, `SandboxTier`, `SandboxModel`) does not exist in earlier releases.

## Prerequisites

```python
import videodb
from videodb import SandboxTier, SandboxModel

conn = videodb.connect()
coll = conn.get_collection()
```

## Model names — use exact IDs

Pass model names exactly as listed in the catalog below. Use the `SandboxModel` enum to avoid typos:

```python
SandboxModel.GEMMA_4_31B   # "google/gemma-4-31B-it"
SandboxModel.QWEN_9B       # "Qwen/Qwen3.5-9B"
SandboxModel.FLUX          # "black-forest-labs/FLUX.1-dev"
```

Plain strings work too — but they must match the catalog exactly, or `create_sandbox` fails with `Unsupported sandbox model`. **Do not add an `-FP8` (or any other) suffix**; the public IDs carry no quantization suffix even though the underlying deployment may be quantized.

## Create a sandbox

Choose a tier based on the **largest** model you plan to run. Creating a sandbox returns immediately while compute provisions in the background.

```python
sandbox = conn.create_sandbox(
    tier=SandboxTier.medium,
    models=[SandboxModel.GEMMA_4_31B.value],
)

sandbox.wait_for_ready(timeout=300, interval=5)
print(sandbox.id, sandbox.status)   # bx-...  active
```

You can prepare a sandbox by **category** instead of exact model names, when a workflow may use several models of the same kind:

```python
sandbox = conn.create_sandbox(
    tier=SandboxTier.medium,
    model_categories=["vlm", "object_detection", "image_generation"],
)
sandbox.wait_for_ready()
```

Supported category names:

| Category           | Use for                                 |
| ------------------ | --------------------------------------- |
| `vlm`              | visual scene understanding models       |
| `object_detection` | object detection models such as RT-DETR |
| `speech_to_text`   | speech recognition models               |
| `text_to_speech`   | speech generation models                |
| `image_generation` | image generation models                 |
| `audio_generation` | audio/music/sound generation models     |
| `text_generation`  | text generation models                  |

**Only submit sandbox-backed jobs after the sandbox is active** (`wait_for_ready()` returns, or `sandbox.is_ready` is `True`).

### Waiting semantics

`wait_for_ready()` polls `refresh()` until the status is `active` or `alert`, and raises if the sandbox reaches a terminal state (`stopped`, `failed`) or the timeout elapses:

- `active` — all requested models are warm and routable.
- `alert` — the sandbox is usable but at least one requested model may be unavailable. Test each workload and record which model failed.

```python
from videodb.exceptions import RequestTimeoutError, InvalidRequestError

try:
    sandbox.wait_for_ready(timeout=600, interval=5)
except (RequestTimeoutError, InvalidRequestError) as e:
    print(f"Sandbox not ready: {e}")
```

## Model catalog

| Model                             | Use case              | Minimum tier |
| --------------------------------- | --------------------- | ------------ |
| `google/gemma-4-E2B-it`           | text generation       | `small`      |
| `Qwen/Qwen3-4B`                   | text generation       | `small`      |
| `Qwen/Qwen3.5-9B`                 | text and vision       | `small`      |
| `openai/whisper-large-v3-turbo`   | speech-to-text        | `small`      |
| `k2-fsa/OmniVoice`                | text-to-speech        | `small`      |
| `stabilityai/stable-audio-open-1.0` | audio generation    | `small`      |
| `rtdetr-v2-r50vd`                 | object detection      | `small`      |
| `google/gemma-4-26B-A4B-it`       | text and vision       | `medium`     |
| `Qwen/Qwen3.5-27B`                | text and vision       | `medium`     |
| `black-forest-labs/FLUX.1-dev`    | image generation      | `medium`     |
| `google/gemma-4-31B-it`           | text and vision       | `medium`     |

## Where the model name and sandbox ID go

| Workflow                | Model field             | Sandbox field                |
| ----------------------- | ----------------------- | ---------------------------- |
| Understanding analyzers | analyzer `config.model` | analyzer `config.sandbox_id` |
| Generation APIs         | `model_name`            | `sandbox_id`                 |

## Understanding + indexing with a sandbox

The sandbox controls **where the model runs** during the understanding step. Indexing is unchanged — you index the produced artifact with the standard `video.index(...)` interface.

```python
sandbox = conn.create_sandbox(
    tier=SandboxTier.medium,
    models=[SandboxModel.GEMMA_4_31B.value],
)
sandbox.wait_for_ready()

video = coll.get_video("m-xxx")

understanding = video.understand(
    analyzers=[
        {
            "type": "vlm",
            "name": "scene",
            "config": {
                "model": "google/gemma-4-31B-it",
                "sandbox_id": sandbox.id,
                "prompt": "Describe the scene in a clear, concise way.",
                "schema": {
                    "scene_description": "string",
                    "activity": "string",
                    "setting": "string",
                },
            },
        }
    ],
)
understanding.wait_until_complete()
scene = understanding.get_analyzer("scene")

video.index(
    name="scene",
    source=scene,
    use_for=["semantic", "query"],
    fields={
        "semantic": ["scene_description", "activity", "setting"],
        "filter": ["activity", "setting"],
    },
)
```

Search the index like any other VideoDB index:

```python
results = video.semantic_search(
    query="person presenting an AI demo",
    index_names=["scene"],
    return_fields=["scene_description", "activity", "setting"],
)
```

See [reference/indexing.md](indexing.md) for segmentation, sampling, and field configuration.

### Object detection

```python
sandbox = conn.create_sandbox(tier=SandboxTier.small, models=["rtdetr-v2-r50vd"])
sandbox.wait_for_ready()

understanding = video.understand(
    analyzers=[
        {
            "type": "object_detection",
            "name": "objects",
            "config": {"model": "rtdetr-v2-r50vd", "sandbox_id": sandbox.id},
        }
    ],
)
understanding.wait_until_complete()
objects = understanding.get_analyzer("objects")

video.index(
    name="objects",
    source=objects,
    use_for=["query", "aggregate"],
    fields={"filter": ["object_labels", "object_counts"], "aggregate": ["object_labels"]},
)
```

## Generation with a sandbox

Generation APIs take `model_name` plus `sandbox_id`. Long-running generation returns a `GenerationJob`; call `job.wait(...)` to get the asset.

### Text generation

`generate_text` runs synchronously (`wait=True` by default) and returns the result directly — no job to poll.

```python
response = coll.generate_text(
    prompt="Summarize the key visual events from this scene description list.",
    model_name="Qwen/Qwen3.5-9B",
    sandbox_id=sandbox.id,
    max_tokens=300,
    temperature=0.2,
)
print(response)
```

### OmniVoice text-to-speech

```python
job = coll.generate_voice(
    text="Welcome to VideoDB Sandbox Compute.",
    model_name="k2-fsa/OmniVoice",
    sandbox_id=sandbox.id,
)
audio = job.wait(timeout=900, interval=5)
print(audio.id)
```

Voice design — steer the style with `config.instructions`:

```python
job = coll.generate_voice(
    text="Breaking update from VideoDB.",
    model_name="k2-fsa/OmniVoice",
    sandbox_id=sandbox.id,
    config={"instructions": "A deep, authoritative news anchor voice"},
)
audio = job.wait(timeout=900, interval=5)
```

Reusable voice clone — create once from a reference asset, then pass `voice_clone_id`:

```python
ref_audio = coll.upload(url="https://.../reference.wav", media_type="audio")
voice_clone = coll.create_voice_clone(
    ref_audio_id=ref_audio.id,
    name="Product Narrator",
    ref_text="Sample reference text for the audio clip",
    language="en",
)

job = coll.generate_voice(
    text="This narration uses a reusable voice clone.",
    model_name="k2-fsa/OmniVoice",
    sandbox_id=sandbox.id,
    voice_clone_id=voice_clone.id,
)
audio = job.wait(timeout=900, interval=5)
```

### FLUX image generation

```python
job = coll.generate_image(
    prompt="A futuristic cityscape at sunset, cinematic lighting, high detail",
    model_name="black-forest-labs/FLUX.1-dev",
    sandbox_id=sandbox.id,
    config={"size": "1280x720", "num_inference_steps": 28, "guidance_scale": 4.0},
)
image = job.wait(timeout=900, interval=5)
print(image.id)
```

> **Note:** `generate_music()` and `generate_sound_effect()` do **not** yet accept `sandbox_id`/`model_name`, so `stabilityai/stable-audio-open-1.0` is listed in the catalog but has no sandbox-routed SDK path yet. Use the hosted music/SFX generation for now.

## Validation and permissions

When you pass `sandbox_id`, VideoDB validates that:

1. the sandbox exists and belongs to your workspace/account,
2. the sandbox is active,
3. the sandbox tier supports the requested model,
4. the sandbox was created with a matching `models` or `model_categories` value (when model selection was provided).

If validation fails, create or start a compatible sandbox and retry the job with that sandbox ID.

## Manage sandboxes

```python
# Refresh one sandbox
sandbox.refresh()
print(sandbox.status, sandbox.is_active)

# List sandboxes (optionally filter by status)
for sb in conn.list_sandboxes(status="active", page_size=100):
    print(sb.id, sb.name, sb.tier, sb.status)

# Get a sandbox by ID
sb = conn.get_sandbox(sandbox.id)
```

## Stop the sandbox

Billing is runtime-based, so stop the sandbox when the workload is complete.

```python
sandbox.stop()
sandbox.wait_for_stop(timeout=120, interval=5)
print(f"Sandbox {sandbox.id} final status: {sandbox.status}")
```

## Pricing and limits

Billing is runtime-based, recorded when the sandbox stops, calculated from `started_at` to `stopped_at`, rounded to 2 decimal hours.

| Sandbox tier |        Price | Concurrent limit | Max runtime |
| ------------ | -----------: | ---------------: | ----------: |
| `small`      |    `$1/hour` |                5 |    24 hours |
| `medium`     | `$3.50/hour` |                3 |    24 hours |

Sandboxes in `provisioning`, `active`, or `alert` all count toward the concurrent limit — so **always run the stop step**, even after a failed workload, or you will hit `Maximum active sandboxes for tier ... reached`.

## Common pitfalls

| Scenario | Error / symptom | Solution |
|----------|-----------------|----------|
| Model ID has a quantization suffix | `Unsupported sandbox model: ...-FP8` | Use the bare public ID (no `-FP8`); prefer the `SandboxModel` enum |
| Submitting a job before the sandbox is active | job routed to hosted path or rejected | Call `wait_for_ready()` first; gate on `sandbox.is_ready` |
| Concurrent-limit error on create | `Maximum active sandboxes for tier 'small' reached (5/5)` | Stop unused sandboxes; provisioning ones count too |
| Sandbox reaches `alert`, not `active` | some requested models unavailable | Test each workload separately; recreate with only the models you need |
| Retrying a timed-out `create_sandbox` | each retry mints a new sandbox | Recover with `list_sandboxes()` by name/status before recreating |
| Expecting music/SFX via sandbox | `generate_music`/`generate_sound_effect` take no `sandbox_id` | Not yet supported; use hosted generation |

## Best practices

- Create one sandbox per workflow and reuse it across compatible jobs.
- Use the smallest tier that supports your largest model.
- Use `models=[...]` when you know the exact models; use `model_categories=[...]` when the workflow may use several models of one kind.
- Wait until the sandbox is active before submitting jobs.
- Pass `sandbox_id=sandbox.id` explicitly for production indexing and generation jobs so routing is predictable.
- Use `job.wait(timeout=900, interval=5)` for long-running generation jobs.
- Log `sandbox.id` with each job so runs can be debugged or retried.
- Stop the sandbox when work is complete.
