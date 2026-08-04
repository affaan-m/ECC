---
name: fal-ai-media
description: Unified media generation via fal.ai MCP — image, video, and audio. Covers text-to-image (Nano Banana), text/image-to-video (Seedance, Kling, Veo 3), text-to-speech (CSM-1B), and video-to-audio (ThinkSound). Use when the user wants to generate images, videos, or audio with AI.
---

# fal.ai Media Generation

Generate images, videos, and audio using fal.ai models via MCP.

## When to Activate

- User wants to generate images from text prompts
- Creating videos from text or images
- Generating speech, music, or sound effects
- Any media generation task
- User says "generate image", "create video", "text to speech", "make a thumbnail", or similar

## MCP Requirement

fal.ai MCP server must be configured. Add to `~/.claude.json`:

```json
"fal-ai": {
  "command": "npx",
  "args": ["-y", "fal-ai-mcp-server"],
  "env": { "FAL_KEY": "YOUR_FAL_KEY_HERE" }
}
```

Get an API key at [fal.ai](https://fal.ai).

## MCP Tools

The fal.ai MCP provides these tools:
- `search` — Find available models by keyword
- `find` — Get model details and parameters
- `generate` — Run a model with parameters
- `result` — Check async generation status
- `status` — Check job status
- `cancel` — Cancel a running job
- `estimate_cost` — Estimate generation cost
- `models` — List popular models
- `upload` — Upload files for use as inputs

---

## Image Generation

### Nano Banana 2 (Fast)
Best for: quick iterations, drafts, text-to-image, image editing.

```
generate(
  model_name: "fal-ai/nano-banana-2",
  input: {
    "prompt": "a futuristic cityscape at sunset, cyberpunk style",
    "image_size": "landscape_16_9",
    "num_images": 1,
    "seed": 42
  }
)
```

### Nano Banana Pro (High Fidelity)
Best for: production images, realism, typography, detailed prompts.

```
generate(
  model_name: "fal-ai/nano-banana-pro",
  input: {
    "prompt": "professional product photo of wireless headphones on marble surface, studio lighting",
    "image_size": "square",
    "num_images": 1,
    "guidance_scale": 7.5
  }
)
```

### Common Image Parameters

| Param | Type | Options | Notes |
|-------|------|---------|-------|
| `prompt` | string | required | Describe what you want |
| `image_size` | string | `square`, `portrait_4_3`, `landscape_16_9`, `portrait_16_9`, `landscape_4_3` | Aspect ratio |
| `num_images` | number | 1-4 | How many to generate |
| `seed` | number | any integer | Reproducibility |
| `guidance_scale` | number | 1-20 | How closely to follow the prompt (higher = more literal) |

### Image Editing
Use Nano Banana 2 with an input image for inpainting, outpainting, or style transfer:

```
# First upload the source image
upload(file_path: "/path/to/image.png")

# Then generate with image input
generate(
  model_name: "fal-ai/nano-banana-2",
  input: {
    "prompt": "same scene but in watercolor style",
    "image_url": "<uploaded_url>",
    "image_size": "landscape_16_9"
  }
)
```

---

## Video Generation

### Seedance 1.0 Pro (ByteDance)
Best for: text-to-video, image-to-video with high motion quality.

```
generate(
  model_name: "fal-ai/seedance-1-0-pro",
  input: {
    "prompt": "a drone flyover of a mountain lake at golden hour, cinematic",
    "duration": "5s",
    "aspect_ratio": "16:9",
    "seed": 42
  }
)
```

### Kling Video v3 Pro
Best for: text/image-to-video with native audio generation.

```
generate(
  model_name: "fal-ai/kling-video/v3/pro",
  input: {
    "prompt": "ocean waves crashing on a rocky coast, dramatic clouds",
    "duration": "5s",
    "aspect_ratio": "16:9"
  }
)
```

### Veo 3 (Google DeepMind)
Best for: video with generated sound, high visual quality.

```
generate(
  model_name: "fal-ai/veo-3",
  input: {
    "prompt": "a bustling Tokyo street market at night, neon signs, crowd noise",
    "aspect_ratio": "16:9"
  }
)
```

### Image-to-Video
Start from an existing image:

```
generate(
  model_name: "fal-ai/seedance-1-0-pro",
  input: {
    "prompt": "camera slowly zooms out, gentle wind moves the trees",
    "image_url": "<uploaded_image_url>",
    "duration": "5s"
  }
)
```

### Video Parameters

| Param | Type | Options | Notes |
|-------|------|---------|-------|
| `prompt` | string | required | Describe the video |
| `duration` | string | `"5s"`, `"10s"` | Video length |
| `aspect_ratio` | string | `"16:9"`, `"9:16"`, `"1:1"` | Frame ratio |
| `seed` | number | any integer | Reproducibility |
| `image_url` | string | URL | Source image for image-to-video |

---

## Audio Generation

### CSM-1B (Conversational Speech)
Text-to-speech with natural, conversational quality.

```
generate(
  model_name: "fal-ai/csm-1b",
  input: {
    "text": "Hello, welcome to the demo. Let me show you how this works.",
    "speaker_id": 0
  }
)
```

### ThinkSound (Video-to-Audio)
Generate matching audio from video content.

```
generate(
  model_name: "fal-ai/thinksound",
  input: {
    "video_url": "<video_url>",
    "prompt": "ambient forest sounds with birds chirping"
  }
)
```

### ElevenLabs (via API, no MCP)
For professional voice synthesis, use ElevenLabs directly:

```python
import os
import requests

resp = requests.post(
    "https://api.elevenlabs.io/v1/text-to-speech/<voice_id>",
    headers={
        "xi-api-key": os.environ["ELEVENLABS_API_KEY"],
        "Content-Type": "application/json"
    },
    json={
        "text": "Your text here",
        "model_id": "eleven_turbo_v2_5",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}
    }
)
with open("output.mp3", "wb") as f:
    f.write(resp.content)
```

### VideoDB Generative Audio
If VideoDB is configured, use its generative audio:

```python
# Voice generation
audio = coll.generate_voice(text="Your narration here", voice="alloy")

# Music generation
music = coll.generate_music(prompt="upbeat electronic background music", duration=30)

# Sound effects
sfx = coll.generate_sound_effect(prompt="thunder crack followed by rain")
```

---

## Cost Estimation

Before generating, check estimated cost:

```
estimate_cost(model_name: "fal-ai/nano-banana-pro", input: {...})
```

## Model Discovery

Find models for specific tasks:

```
search(query: "text to video")
find(model_name: "fal-ai/seedance-1-0-pro")
models()
```

## Tips

- Use `seed` for reproducible results when iterating on prompts
- Start with lower-cost models (Nano Banana 2) for prompt iteration, then switch to Pro for finals
- For video, keep prompts descriptive but concise — focus on motion and scene
- Image-to-video produces more controlled results than pure text-to-video
- Check `estimate_cost` before running expensive video generations

## Related Skills

- `videodb` — Video processing, editing, and streaming
- `video-editing` — AI-powered video editing workflows
- `content-engine` — Content creation for social platforms
