---
name: regex-vs-llm-structured-text
description: Decision framework for choosing between regex and LLM when parsing structured text — start with regex, add LLM only for low-confidence edge cases.
---

# Regex vs LLM for Structured Text Parsing

A practical decision framework for parsing structured text (quizzes, forms, invoices, documents). The key insight: regex handles 95-98% of cases cheaply and deterministically. Reserve expensive LLM calls for the remaining edge cases.

## When to Activate

- Parsing structured text with repeating patterns (questions, forms, tables)
- Deciding between regex and LLM for text extraction
- Building hybrid pipelines that combine both approaches
- Optimizing cost/accuracy tradeoffs in text processing

## Decision Framework

```
Is the text format consistent and repeating?
├── Yes (>90% follows a pattern) → Start with Regex
│   ├── Regex handles 95%+ → Done, no LLM needed
│   └── Regex handles <95% → Add LLM for edge cases only
└── No (free-form, highly variable) → Use LLM directly
```

## Architecture Pattern

```
Source Text
    │
    ▼
[Regex Parser] ─── Extracts structure (95-98% accuracy)
    │
    ▼
[Text Cleaner] ─── Removes noise (markers, page numbers, artifacts)
    │
    ▼
[Confidence Scorer] ─── Flags low-confidence extractions
    │
    ├── High confidence (≥0.95) → Direct output
    │
    └── Low confidence (<0.95) → [LLM Validator] → Output
```

## Implementation

### 1. Regex Parser (Handles the Majority)

```python
import re
from dataclasses import dataclass

@dataclass(frozen=True)
class ParsedItem:
    id: str
    text: str
    choices: tuple[str, ...]
    answer: str
    confidence: float = 1.0

def parse_structured_text(content: str) -> list[ParsedItem]:
    """Parse structured text using regex patterns."""
    pattern = re.compile(
        r"(?P<id>\d+)\.\s*(?P<text>.+?)\n"
        r"(?P<choices>(?:[A-D]\..+?\n)+)"
        r"Answer:\s*(?P<answer>[A-D])",
        re.MULTILINE | re.DOTALL,
    )
    items = []
    for match in pattern.finditer(content):
        choices = tuple(
            c.strip() for c in re.findall(r"[A-D]\.\s*(.+)", match.group("choices"))
        )
        items.append(ParsedItem(
            id=match.group("id"),
            text=match.group("text").strip(),
            choices=choices,
            answer=match.group("answer"),
        ))
    return items
```

### 2. Confidence Scoring

Flag items that may need LLM review:

```python
@dataclass(frozen=True)
class ConfidenceFlag:
    item_id: str
    score: float
    reasons: tuple[str, ...]

def score_confidence(item: ParsedItem) -> ConfidenceFlag:
    """Score extraction confidence and flag issues."""
    reasons = []
    score = 1.0

    if len(item.choices) < 3:
        reasons.append("few_choices")
        score -= 0.3

    if not item.answer:
        reasons.append("missing_answer")
        score -= 0.5

    if len(item.text) < 10:
        reasons.append("short_text")
        score -= 0.2

    return ConfidenceFlag(
        item_id=item.id,
        score=max(0.0, score),
        reasons=tuple(reasons),
    )

def identify_low_confidence(
    items: list[ParsedItem],
    threshold: float = 0.95,
) -> list[ConfidenceFlag]:
    """Return items below confidence threshold."""
    flags = [score_confidence(item) for item in items]
    return [f for f in flags if f.score < threshold]
```

### 3. LLM Validator (Edge Cases Only)

```python
def validate_with_llm(
    item: ParsedItem,
    original_text: str,
    client,
) -> ParsedItem:
    """Use LLM to fix low-confidence extractions."""
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",  # Cheapest model for validation
        max_tokens=500,
        messages=[{
            "role": "user",
            "content": (
                f"Extract the question, choices, and answer from this text.\n\n"
                f"Text: {original_text}\n\n"
                f"Current extraction: {item}\n\n"
                f"Return corrected JSON if needed, or 'CORRECT' if accurate."
            ),
        }],
    )
    # Parse LLM response and return corrected item...
    return corrected_item
```

### 4. Hybrid Pipeline

```python
def process_document(
    content: str,
    *,
    llm_client=None,
    confidence_threshold: float = 0.95,
) -> list[ParsedItem]:
    """Full pipeline: regex -> confidence check -> LLM for edge cases."""
    # Step 1: Regex extraction (handles 95-98%)
    items = parse_structured_text(content)

    # Step 2: Confidence scoring
    low_confidence = identify_low_confidence(items, confidence_threshold)

    if not low_confidence or llm_client is None:
        return items

    # Step 3: LLM validation (only for flagged items)
    low_conf_ids = {f.item_id for f in low_confidence}
    result = []
    for item in items:
        if item.id in low_conf_ids:
            result.append(validate_with_llm(item, content, llm_client))
        else:
            result.append(item)

    return result
```

## Real-World Metrics

From a production quiz parsing pipeline (410 items):

| Metric | Value |
|--------|-------|
| Regex success rate | 98.0% |
| Low confidence items | 8 (2.0%) |
| LLM calls needed | ~5 |
| Cost savings vs all-LLM | ~95% |
| Test coverage | 93% |

## Best Practices

- **Start with regex** — even imperfect regex gives you a baseline to improve
- **Use confidence scoring** to programmatically identify what needs LLM help
- **Use the cheapest LLM** for validation (Haiku-class models are sufficient)
- **Never mutate** parsed items — return new instances from cleaning/validation steps
- **TDD works well** for parsers — write tests for known patterns first, then edge cases
- **Log metrics** (regex success rate, LLM call count) to track pipeline health

## Anti-Patterns to Avoid

- Sending all text to an LLM when regex handles 95%+ of cases (expensive and slow)
- Using regex for free-form, highly variable text (LLM is better here)
- Skipping confidence scoring and hoping regex "just works"
- Mutating parsed objects during cleaning/validation steps
- Not testing edge cases (malformed input, missing fields, encoding issues)

## When to Use

- Quiz/exam question parsing
- Form data extraction
- Invoice/receipt processing
- Document structure parsing (headers, sections, tables)
- Any structured text with repeating patterns where cost matters
