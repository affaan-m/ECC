---
name: llm-from-scratch-appendix-lora
description: Use when implementing LoRA for parameter-efficient FT.
---
# LoRA Fine-Tuning (Raschka Appendix E)

## Formula
- W' = W + B @ A  (A: r×d, B: d×r)
- Only A, B trained; W frozen
- r: 4, 8, 16, 32, 64 | alpha: 16, 32
- Effective LR = base_lr * (alpha / r)

## Target Modules
- Attention: q, k, v, o proj (most impactful)
- FFN: gate, up, down proj
- All-linear: everything

## Merging (Critical)
```python
# CONCATENATE factors, never average
# r_new = N * r, KEEP alpha
merged_weight = base_weight + sum(lora_B @ lora_A * scale)
```

## When to Use
- FT large models on limited GPU
- Multiple task adapters
- Merge adapters for deployment
