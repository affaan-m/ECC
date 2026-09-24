---
description: Export instincts for sharing
agent: build
---

# Instinct Export Command

Export instincts for sharing with others: $ARGUMENTS

## Your Task

Export instincts from the continuous-learning-v2 system.

## Export Options

### Export All
```
/instinct-export
```

### Export High Confidence Only
```
/instinct-export --min-confidence 0.8
```

### Export by Category
```
/instinct-export --category coding
```

### Export to Specific Path
```
/instinct-export --output ./my-instincts.json
```

## Export Format

```json
{
  "instincts": [
    {
      "id": "instinct-123",
      "trigger": "[situation description]",
      "action": "[recommended action]",
      "confidence": 0.85,
      "category": "coding",
      "applications": 10,
      "successes": 9,
      "source": "session-observation"
    }
  ],
  "metadata": {
    "version": "1.0",
    "exported": "2025-01-15T10:00:00Z",
    "author": "username",
    "total": 25,
    "filter": "confidence >= 0.8"
  }
}
```

## Export Report

```
Export Summary
==============
Output: ./instincts-export.json
Total instincts: X
Filtered: Y
Exported: Z

Categories:
- coding: N
- testing: N
- security: N
- git: N

Top Instincts (by confidence):
1. [trigger] (0.XX)
2. [trigger] (0.XX)
3. [trigger] (0.XX)
```

## Sharing

After export:
- Share JSON file directly
- Upload to team repository
- Publish to instinct registry

---

**TIP**: Export high-confidence instincts (>0.8) for better quality shares.
