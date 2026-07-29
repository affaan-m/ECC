---
description: "Python coding style for Python services, scripts, and FastAPI/Django apps. Apply when writing, reviewing, or refactoring formatting, naming, structure, and readability."
alwaysApply: false
---
# Python Coding Style

> This file extends the common coding style rule with Python specific content.

## Standards

- Follow **PEP 8** conventions
- Use **type annotations** on all function signatures

## Immutability

Prefer immutable data structures:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class User:
    name: str
    email: str

from typing import NamedTuple

class Point(NamedTuple):
    x: float
    y: float
```

## Formatting

- **black** for code formatting
- **isort** for import sorting
- **ruff** for linting

## Reference

See skill: `python-patterns` for comprehensive Python idioms and patterns.
