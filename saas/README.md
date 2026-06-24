# TokenGuard — AI Token Cost & Carbon Optimizer

> Sits between your organization and AI APIs. Reduces token spend by 40–70%. Quantifies and reduces CO₂ emissions.

## Quick Start

```bash
cd saas
npm install
cp .env.example .env    # add your API keys
npm start
# → http://localhost:3000         (landing page)
# → http://localhost:3000/dashboard (live analytics)
```

## How to integrate

**Python / OpenAI SDK**
```python
import openai
client = openai.OpenAI(
    api_key="sk-...",
    base_url="http://localhost:3000/proxy/openai"
)
```

**Node.js / Anthropic SDK**
```js
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({
  apiKey: 'sk-ant-...',
  baseURL: 'http://localhost:3000/proxy/anthropic',
});
```

**HTTP headers**
```
X-TokenGuard-Org: my-team          # Track per-team savings
X-TokenGuard-Aggressive: true      # Enable filler removal
X-TokenGuard-No-Cache: true        # Bypass cache for this request
```

## Supported Providers

| Provider | Path prefix |
|----------|-------------|
| OpenAI | `/proxy/openai/v1/...` |
| Anthropic | `/proxy/anthropic/v1/...` |
| Google Vertex AI | `/proxy/google/...` |
| AWS Bedrock | `/proxy/bedrock/...` |

## API

```
GET /api/stats       → totals (cost saved, tokens, CO₂, cache hits)
GET /api/recent      → last N requests with savings breakdown
GET /api/orgs        → per-org savings leaderboard
GET /api/timeseries  → hourly buckets for charts
GET /api/providers   → supported providers and models
```

## Optimization Techniques

1. **Whitespace compression** — collapse redundant spaces/newlines
2. **Filler phrase removal** — strip "please note that", "in order to", etc.
3. **System-prompt deduplication** — remove repeated lines across messages
4. **User-message truncation** — trim oversized messages to a token budget
5. **Semantic caching** — return cached responses for repeated prompts (100% savings)
6. **Model routing** *(roadmap)* — auto-route simple queries to cheaper models

## Carbon Impact

Each provider/model has a gCO₂-per-1M-tokens estimate based on published GPU energy figures.
Every token saved = less GPU compute = less CO₂. The dashboard shows:

- gCO₂ avoided per request
- Total CO₂ saved across all teams
- Carbon savings certificate (PDF) for ESG/sustainability reporting
