---
name: ai-engineering-ch3-4-evaluation
description: Use when building AI eval pipelines.
---
# AI Evaluation Pipeline (Huyen Ch 3-4)

## Levels
1. Model-level: MMLU, GSM8K, HumanEval
2. Application-level: task-specific
3. Component-level: retrieval, tool use

## Offline Eval
- Golden set: human-labeled (50-200 cases)
- Synthetic: LLM generates diverse tests
- LLM-as-judge: pairwise, rubric, median of multiple

## Online Eval
- A/B: shadow, gradual rollout
- User feedback: implicit (regen, edit) + explicit
- Drift: embedding shift, metric decay

## Eval-Driven Development
```
1. Define success criteria + thresholds
2. Build golden set
3. CI-integrated eval harness
4. Iterate: prompt → eval → analyze → fix
5. Regression gate: must beat baseline
```

## When to Use
- Setting up eval for new feature
- Building regression detection
