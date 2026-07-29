---
description: "Python security for Python services, scripts, and FastAPI/Django apps. Apply when writing, reviewing, or refactoring validation, secrets, auth, and vulnerability prevention."
alwaysApply: false
---
# Python Security

> This file extends the common security rule with Python specific content.

## Secret Management

```python
import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.environ["OPENAI_API_KEY"]  # Raises KeyError if missing
```

## Security Scanning

- Use **bandit** for static security analysis:
  ```bash
  bandit -r src/
  ```

## Reference

See skill: `django-security` for Django-specific security guidelines (if applicable).
