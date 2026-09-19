---
name: llm-from-scratch-ch1-understanding
description: Use when learning LLM fundamentals from Raschka Ch 1.
---
# LLM Fundamentals (Raschka Ch 1)

## Core Concepts
- **LLM** = deep neural network using transformer architecture, trained on vast text data via self-supervision
- **Generative AI** = models that generate text (completion, translation, summarization, coding, math)
- **Two-stage training**: pretraining (unlabeled data, next-token prediction) → fine-tuning (labeled data, instruction/classification)

## Transformer Architecture (high-level)
- Encoder-decoder for translation; GPT uses decoder-only; BERT uses encoder-only
- Self-attention: selectively attend to different input parts
- Scales to billions of parameters

## Why Build Custom LLMs
- Domain specialization (finance, medical) outperforms general models
- Data privacy — keep sensitive data in-house
- Edge deployment (laptops/phones) — smaller models
- Full autonomy over updates/modifications

## Prerequisites
- Solid Python; high-school linear algebra; ML background helpful but not required
- PyTorch introduced in Appendix A

## When to Use
- Starting LLM education from zero
- Need mental model before coding
- Explaining LLM basics to stakeholders
