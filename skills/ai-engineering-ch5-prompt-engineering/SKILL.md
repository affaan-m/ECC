---
name: ai-engineering-ch5-prompt-engineering
description: Use when designing production prompts.
---
# Prompt Engineering for Production (Huyen Ch 5)

## Techniques
- Zero-shot: instruction only
- Few-shot: 3-8 diverse examples
- CoT: "Think step by step"
- Self-consistency: N samples, majority vote
- Structured: JSON schema, function calling

## Template System
```python
class PromptTemplate:
    def __init__(self, system, user_template, few_shot=[]):
        ...
    def render(self, **kwargs):
        messages = [{"role": "system", "content": self.system}]
        for ex in self.few_shot:
            messages += [{"role": "user", "content": ex["input"]},
                         {"role": "assistant", "content": ex["output"]}]
        messages.append({"role": "user", "content": self.user_template.format(**kwargs)})
        return messages
```

## Injection Defense
- Delimiter-based: `{{user_input}}`
- Instruction hierarchy: system > dev > user
- Output validation: schema check

## When to Use
- Designing production prompts
- Securing LLM endpoints
- Prompt CI/CD
