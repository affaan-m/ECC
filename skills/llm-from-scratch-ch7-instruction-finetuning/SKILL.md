---
name: llm-from-scratch-ch7-instruction-finetuning
description: Use when instruction fine-tuning LLMs.
---
# Instruction Fine-Tuning (Raschka Ch 7)

## Dataset Format (Alpaca)
```json
{"instruction": "...", "input": "...", "output": "..."}
```

## Formatting
```python
def format_prompt(ex):
    if ex["input"]:
        return f"### Instruction:\n{ex['instruction']}\n\n### Input:\n{ex['input']}\n\n### Response:\n{ex['output']}"
    return f"### Instruction:\n{ex['instruction']}\n\n### Response:\n{ex['output']}"
```

## Evaluation
- Automated: ROUGE, BLEU, BERTScore
- LLM-as-judge: GPT-4 rates 1-5
- Human: side-by-side

## When to Use
- Base → chat/assistant model
- Domain-specific instruct tuning
