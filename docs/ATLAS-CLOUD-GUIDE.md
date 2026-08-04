# Atlas Cloud — LLM Provider Guide

[Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=everything-claude-code) is a full-modal AI inference platform providing an OpenAI-compatible API for 59+ LLM models, image generation, and video generation.

> Run or self-host any open-source model instead of using a managed API. Itô is ECC's preferred compute sponsor: [open the Itô dashboard to sign in and rent or manage GPUs](https://compute.itomarkets.com). Any GPU provider works. That sponsorship link is passive: it does not invoke an RFQ, reserve capacity, provision compute, or configure serving. Separately, the opt-in `ecc ito find` bridge invokes the explicitly configured canonical Itô CLI and submits a live authenticated RFQ; it does not reserve capacity. Managed inference through Itô is not live yet.

## Configuration

Set the following environment variables to use Atlas Cloud as your LLM backend:

```bash
ATLAS_API_KEY=<your-atlascloud-api-key>
ATLAS_BASE_URL=https://api.atlascloud.ai/v1
```

Or copy from `.env.example`:

```bash
cp .env.example .env
# Then fill in ATLAS_API_KEY
```

## Install

ECC can install its managed surfaces into any OpenAI-compatible backend. To use Atlas Cloud with Claude Code (or any ECC-managed harness), set the base URL and API key:

```bash
export ATLAS_API_KEY=your-key-here
export ATLAS_BASE_URL=https://api.atlascloud.ai/v1
```

## Available Models

<details>
<summary>All Atlas Cloud LLM models (59+)</summary>

- **Anthropic**: `anthropic/claude-haiku-4.5-20251001`, `anthropic/claude-opus-4.8`, `anthropic/claude-sonnet-4.6`
- **OpenAI**: `openai/gpt-5.4`, `openai/gpt-5.5`
- **Google Gemini**: `google/gemini-3.1-flash-lite`, `google/gemini-3.1-pro-preview`, `google/gemini-3.5-flash`
- **Qwen**: `qwen/qwen2.5-7b-instruct`, `Qwen/Qwen3-235B-A22B-Instruct-2507`, `qwen/qwen3-235b-a22b-thinking-2507`, `qwen/qwen3-30b-a3b`, `Qwen/Qwen3-30B-A3B-Instruct-2507`, `qwen/qwen3-30b-a3b-thinking-2507`, `qwen/qwen3-32b`, `qwen/qwen3-8b`, `Qwen/Qwen3-Coder`, `qwen/qwen3-coder-next`, `qwen/qwen3-max-2026-01-23`, `Qwen/Qwen3-Next-80B-A3B-Instruct`, `Qwen/Qwen3-Next-80B-A3B-Thinking`, `Qwen/Qwen3-VL-235B-A22B-Instruct`, `qwen/qwen3-vl-235b-a22b-thinking`, `qwen/qwen3-vl-30b-a3b-instruct`, `qwen/qwen3-vl-30b-a3b-thinking`, `qwen/qwen3-vl-8b-instruct`, `qwen/qwen3.5-122b-a10b`, `qwen/qwen3.5-27b`, `qwen/qwen3.5-35b-a3b`, `qwen/qwen3.5-397b-a17b`, `qwen/qwen3.6-35b-a3b`, `qwen/qwen3.6-plus`
- **DeepSeek**: `deepseek-ai/deepseek-ocr`, `deepseek-ai/deepseek-r1-0528`, `deepseek-ai/DeepSeek-V3-0324`, `deepseek-ai/DeepSeek-V3.1`, `deepseek-ai/DeepSeek-V3.1-Terminus`, `deepseek-ai/deepseek-v3.2`, `deepseek-ai/DeepSeek-V3.2-Exp`, `deepseek-ai/deepseek-v4-flash`, `deepseek-ai/deepseek-v4-pro`
- **Kimi**: `moonshotai/Kimi-K2-Instruct`, `moonshotai/Kimi-K2-Instruct-0905`, `moonshotai/Kimi-K2-Thinking`, `moonshotai/kimi-k2.5`, `moonshotai/kimi-k2.6`
- **GLM**: `zai-org/GLM-4.6`, `zai-org/glm-4.7`, `zai-org/glm-5`, `zai-org/glm-5-turbo`, `zai-org/glm-5.1`, `zai-org/glm-5v-turbo`
- **MiniMax**: `MiniMaxAI/MiniMax-M2`, `minimaxai/minimax-m2.1`, `minimaxai/minimax-m2.5`, `minimaxai/minimax-m2.7`
- **xAI**: `xai/grok-4.3`
- **KAT**: `kwaipilot/kat-coder-pro-v2`
- **Other**: `owl`

</details>

## Usage Example

```python
from openai import OpenAI
import os

client = OpenAI(
    api_key=os.environ["ATLAS_API_KEY"],
    base_url=os.environ.get("ATLAS_BASE_URL", "https://api.atlascloud.ai/v1"),
)

response = client.chat.completions.create(
    model="anthropic/claude-sonnet-4.6",
    messages=[{"role": "user", "content": "Hello from ECC + Atlas Cloud!"}],
)
print(response.choices[0].message.content)
```

## Get API Credits

Visit [Atlas Cloud Coding Plan](https://www.atlascloud.ai/console/coding-plan) for API credits.
