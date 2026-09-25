---
name: ai-engineering-ch9-inference-optimization
description: Use when optimizing LLM inference.
---
# Inference Optimization (Huyen Ch 9)

## Quantization
| Method | Bits | Calibration | Speedup |
|---|---|---|---|
| GPTQ | 4/3/2 | 128 samples | 2-4x |
| AWQ | 4/3 | activation-aware | 2-4x |
| GGUF | 4-8 | none | CPU/GPU |
| SmoothQuant | 8 (w8a8) | act scaling | 1.5x |

## KV Cache
- Standard: [batch, heads, seq, head_dim]/layer
- MQA: 1 KV head/layer
- GQA: n KV heads (n < query heads)
- Paged (vLLM): virtual memory blocks

## Speculative Decoding
- Small draft → N tokens → verify with target
- 50-80% accept → 2-3x speedup

## Batching
- Continuous (vLLM): prefill + decode interleaved
- Chunked prefill: split long prefill

## Frameworks
- vLLM: PagedAttention, OpenAI API
- TGI: Rust, GQA, speculative
- llama.cpp: GGUF, CPU+GPU offload
- TensorRT-LLM: NVIDIA, FP8

## When to Use
- Reducing serving cost/latency
- Choosing quantization
- Scaling inference
