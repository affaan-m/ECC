---
name: llm-from-scratch-ch2-text-data
description: Use when preparing text data for LLMs.
---
# Working with Text Data (Raschka Ch 2)

## Tokenization
- **Word-level**: large vocab, OOV issues
- **Character-level**: small vocab, long sequences
- **BPE**: balances vocab size & meaningful units ("cooking" → "cook" + "ing")
- **Special tokens**: `<|endoftext|>`, `<|pad|>`, `<|unk|>`

## Token Embeddings
- Learnable vectors per token ID
- Positional encoding added (sinusoidal or learned)

## Data Sampling
- Sliding window over token sequences
- Creates (input, target) pairs for next-token prediction

## When to Use
- Building data pipeline for pretraining/fine-tuning
- Choosing tokenization strategy
- Debugging tokenization issues
