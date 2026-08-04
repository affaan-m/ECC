---
description: Run evaluation against acceptance criteria
agent: build
---

# Eval Command

Evaluate implementation against acceptance criteria: $ARGUMENTS

## Your Task

Run structured evaluation to verify the implementation meets requirements.

## Evaluation Framework

### Grader Types

1. **Binary Grader** - Pass/Fail
   - Does it work? Yes/No
   - Good for: feature completion, bug fixes

2. **Scalar Grader** - Score 0-100
   - How well does it work?
   - Good for: performance, quality metrics

3. **Rubric Grader** - Category scores
   - Multiple dimensions evaluated
   - Good for: comprehensive review

## Evaluation Process

### Step 1: Define Criteria

```
Acceptance Criteria:
1. [Criterion 1] - [weight]
2. [Criterion 2] - [weight]
3. [Criterion 3] - [weight]
```

### Step 2: Run Tests

For each criterion:
- Execute relevant test
- Collect evidence
- Score result

### Step 3: Calculate Score

```
Final Score = Σ (criterion_score × weight) / total_weight
```

### Step 4: Report

## Evaluation Report

### Overall: [PASS/FAIL] (Score: X/100)

### Criterion Breakdown

| Criterion | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| [Criterion 1] | X/10 | 30% | X |
| [Criterion 2] | X/10 | 40% | X |
| [Criterion 3] | X/10 | 30% | X |

### Evidence

**Criterion 1: [Name]**
- Test: [what was tested]
- Result: [outcome]
- Evidence: [screenshot, log, output]

### Recommendations

[If not passing, what needs to change]

## Pass@K Metrics

For non-deterministic evaluations:
- Run K times
- Calculate pass rate
- Report: "Pass@K = X/K"

---

**TIP**: Use eval for acceptance testing before marking features complete.
