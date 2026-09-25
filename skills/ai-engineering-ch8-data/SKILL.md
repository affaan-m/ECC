---
name: ai-engineering-ch8-data
description: Use when curating data for AI.
---
# Data for AI Engineering (Huyen Ch 8)

## Sources
| Source | Cost | Quality | Scale |
|---|---|---|---|
| Human | High | Highest | Limited |
| Synthetic (LLM) | Low | Variable | Unlimited |
| Distillation | Medium | High | Large |
| User feedback | Free | Noisy | Continuous |

## Annotation Workflow
```
1. Guidelines + edge cases
2. Pilot: 3 annotators × 100 → agreement
3. Calibrate: resolve, update guidelines
4. Scale with golden samples
5. Monitor: Krippendorff's alpha, throughput
```

## Quality Evaluation
- Intrinsic: perplexity, diversity, toxicity
- Extrinsic: downstream model perf
- Slices: by domain, length, language

## Pipeline
```python
class DataPipeline:
    steps = [Deduplicate(), FilterLanguage(),
             FilterQuality(min_ppl, max_ppl),
             FilterPII(), Chunk(), FormatTemplate()]
```

## When to Use
- Building training/FT dataset
- Setting up annotation program
