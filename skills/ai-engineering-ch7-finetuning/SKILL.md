---
name: ai-engineering-ch7-finetuning
description: Use when fine-tuning FMs — LoRA/QLoRA, merging.
---
# Fine-Tuning Foundation Models (Huyen Ch 7)

## Methods Comparison
| Method | Trainable | VRAM (7B) | Quality |
|---|---|---|---|
| Full FT | 100% | ~60 GB | Highest |
| LoRA (r=64) | ~1% | ~16 GB | Near-full |
| QLoRA (4-bit) | ~1% | ~8 GB | Near-full |
| Adapters | ~0.5% | ~12 GB | Good |

## Memory Calculation
```
weights: params * 0.5 bytes (4-bit)
gradients: same
optimizer: 2x params (AdamW)
activations: batch * seq * hidden * layers * 2
KV cache: 2 * layers * heads * head_dim * seq * batch
```

## Model Merging
- SLERP: spherical interpolation
- TIES: trim, elect sign, merge
- DARE: drop and rescale
- LoRA soup: CONCATENATE (r_new = N*r, keep alpha)

## Data Quality
- Diversity, correctness, difficulty, format consistency

## When to Use
- Choosing FT method for budget/quality
- Merging multiple fine-tunes
- Calculating GPU requirements
