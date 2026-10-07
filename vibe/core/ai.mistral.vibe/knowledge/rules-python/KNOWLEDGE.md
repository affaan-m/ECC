---
name: rules-python
description: ECC python engineering rules for coding style, patterns, security, and testing.
display_name: "ECC Python Rules"
icon: book
---

# ECC Python Rules

## Python Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with Python specific content.

### Standards

- Follow **PEP 8** conventions
- Use **type annotations** on all function signatures

### Immutability

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

### Formatting

- **black** for code formatting
- **isort** for import sorting
- **ruff** for linting

### Reference

See skill: `python-patterns` for comprehensive Python idioms and patterns.

## FastAPI Rules

Use these rules for FastAPI projects alongside the general Python rules.

### Structure

- Put app construction in `create_app()`.
- Keep routers thin; move persistence and business behavior into services or CRUD helpers.
- Keep request schemas, update schemas, and response schemas separate.
- Keep database sessions and auth in dependencies.

### Async

- Use `async def` for endpoints that perform I/O.
- Use async database and HTTP clients from async endpoints.
- Do not call `requests`, sync SQLAlchemy sessions, or blocking file/network operations from async routes.

### Dependency Injection

```python
@router.get("/users/{user_id}")
async def get_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ...
```

Do not create `SessionLocal()` or long-lived clients inside route handlers.

### Schemas

- Never include passwords, password hashes, access tokens, refresh tokens, or internal auth state in response models.
- Use `response_model` on endpoints that return application data.
- Use field constraints instead of hand-written validation when Pydantic can express the rule.

### Security

- Keep CORS origins environment-specific.
- Do not combine wildcard origins with credentialed CORS.
- Validate JWT expiry, issuer, audience, and algorithm.
- Rate-limit auth and write-heavy endpoints.
- Redact credentials, cookies, authorization headers, and tokens from logs.

### Testing

- Override the exact dependency used by `Depends`.
- Clear `app.dependency_overrides` after tests.
- Prefer async test clients for async applications.

See skill: `fastapi-patterns`.

## Python Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Python specific content.

### PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **black/ruff**: Auto-format `.py` files after edit
- **mypy/pyright**: Run type checking after editing `.py` files

### Warnings

- Warn about `print()` statements in edited files (use `logging` module instead)

## Python Patterns

> This file extends [common/patterns.md](../common/patterns.md) with Python specific content.

### Protocol (Duck Typing)

```python
from typing import Protocol

class Repository(Protocol):
    def find_by_id(self, id: str) -> dict | None: ...
    def save(self, entity: dict) -> dict: ...
```

### Dataclasses as DTOs

```python
from dataclasses import dataclass

@dataclass
class CreateUserRequest:
    name: str
    email: str
    age: int | None = None
```

### Context Managers & Generators

- Use context managers (`with` statement) for resource management
- Use generators for lazy evaluation and memory-efficient iteration

### Reference

See skill: `python-patterns` for comprehensive patterns including decorators, concurrency, and package organization.

## Python Security

> This file extends [common/security.md](../common/security.md) with Python specific content.

### Secret Management

```python
import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.environ["OPENAI_API_KEY"]  # Raises KeyError if missing
```

### Security Scanning

- Use **bandit** for static security analysis:
  ```bash
  bandit -r src/
  ```

### Reference

See skill: `django-security` for Django-specific security guidelines (if applicable).

## Python Testing

> This file extends [common/testing.md](../common/testing.md) with Python specific content.

### Framework

Use **pytest** as the testing framework.

### Coverage

```bash
pytest --cov=src --cov-report=term-missing
```

### Test Organization

Use `pytest.mark` for test categorization:

```python
import pytest

@pytest.mark.unit
def test_calculate_total():
    ...

@pytest.mark.integration
def test_database_connection():
    ...
```

### Reference

See skill: `python-testing` for detailed pytest patterns and fixtures.
