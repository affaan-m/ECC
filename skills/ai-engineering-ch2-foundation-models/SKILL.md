---
name: ai-engineering-ch2-foundation-models
description: Use when selecting/understanding FMs.
---
# Foundation Model Internals (Huyen Ch 2)

## Data Recipe
- Mix: web, code, books, academic, multilingual
- Quality: perplexity, dedup, PII removal
- Chinchilla: 20 tokens/param optimal

## Architecture
- Dense (GPT, Llama): all params active
- MoE (Mixtral): sparse activation
- Attention: FlashAttention, GQA, MLA
- Positional: RoPE, ALiBi

## Alignment
| Method | Mechanism |
|---|---|
| RLHF (PPO) | Reward model + policy opt |
| DPO | Direct pref opt, no RM |
| Constitutional AI | Self-critique + revision |
| KTO | Binary prefs, no pairwise |

## Generation Settings (Cheap Boost)
- Temp: 0→1.0 | Top-p: 0.9-0.95 | Top-k: 40-50
- Repetition penalty: 1.0-1.2 | Min-p: dynamic

## When to Use
- Choosing model for application
- Debugging generation quality
