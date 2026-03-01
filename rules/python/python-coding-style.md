# Coding Style

## Target

- Python 3.13+
- Line length: 100
- Quote style: single quotes

## Immutability (CRITICAL)

Prefer immutable data, avoid in-place mutation:

```python
# WRONG: Mutation
def update_user(user: dict, name: str) -> dict:
    user['name'] = name  # MUTATION!
    return user

# CORRECT: Immutability
def update_user(user: dict, name: str) -> dict:
    return {**user, 'name': name}
```

For dataclasses, use `frozen=True`:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class User:
    name: str
    email: str
```

## File Organization

MANY SMALL FILES > FEW LARGE FILES:

- High cohesion, low coupling
- 200-400 lines typical, 800 max
- Extract utilities from large modules
- Organize by feature/domain, not by type

## Error Handling

ALWAYS handle errors comprehensively:

```python
try:
    result = risky_operation()
    return result
except SpecificError as e:
    logger.error('Operation failed: %s', e)
    raise RuntimeError('Detailed user-friendly message') from e
```

- Use `logging` module, not `print()`
- Catch specific exceptions, not bare `except` (BLE rule)
- Chain exceptions with `from e`
- Use error message variables (EM rule)

## Docstrings

Google convention. Required on public modules, classes, and functions:

```python
def process_items(items: list[str], *, limit: int = 10) -> dict[str, int]:
    """Process items and return a mapping of item to length.

    Args:
        items: List of strings to process.
        limit: Maximum number of items to process.

    Returns:
        Mapping of each item to its length.
    """
    return {item: len(item) for item in items[:limit]}
```

## Input Validation

ALWAYS validate user input:

```python
from pydantic import BaseModel, EmailStr, Field

class UserInput(BaseModel):
    email: EmailStr
    age: int = Field(ge=0, le=150)

validated = UserInput.model_validate(raw_input)
```

## Type Hints

ALWAYS use type hints (ANN rules enabled):

```python
def process_items(items: list[str], *, limit: int = 10) -> dict[str, int]:
    return {item: len(item) for item in items[:limit]}
```

- Use `ty check` for type verification
- Use modern syntax: `list[str]` not `List[str]`, `str | None` not `Optional[str]`
- Exemptions: `*args` (ANN002), `**kwargs` (ANN003), special methods return (ANN204)

## Ruff Lint Rules

Key enabled rule categories:

- **S**: Security (bandit) - SQL injection, eval, hardcoded passwords
- **ANN**: Type annotations required
- **D**: Docstrings (Google convention)
- **B/B9**: Bugbear - common pitfalls
- **C4**: Comprehensions - prefer list/dict/set comprehensions
- **PTH**: Use `pathlib.Path` instead of `os.path`
- **UP**: Pyupgrade - modernize syntax
- **SIM**: Simplify - reduce code complexity
- **PERF**: Performance lints
- **PT**: Pytest style
- **I**: Import sorting (isort)
- **N**: PEP 8 naming
- **RUF**: Ruff-specific rules

Per-file ignores:

- `tests/**`: No annotations (ANN), no docstrings (D100/D103/D104), assert allowed (S101)
- `__init__.py`: Unused imports (F401/F403), import order (E402) allowed
- `configs/**`: Unused imports (F401), import order (E402) allowed

## Toolchain

- **Formatter**: `uv run ruff format` (single quotes, 100 chars)
- **Linter**: `uv run ruff check`
- **Type checker**: `uv run ty check`
- **Test runner**: `uv run pytest`
- **Package manager**: `uv` (never pip)
- **Coverage**: fail_under = 50%, branch coverage enabled

## Code Quality Checklist

Before marking work complete:

- [ ] Code is readable and well-named (snake_case)
- [ ] Functions are small (<50 lines), max complexity 18
- [ ] Files are focused (<800 lines)
- [ ] No deep nesting (>4 levels)
- [ ] Proper error handling with logging
- [ ] No print() statements (use logging)
- [ ] No hardcoded values
- [ ] Type hints on all public functions
- [ ] Google-style docstrings on public API
- [ ] Use `pathlib.Path` not `os.path`
- [ ] `uv run ruff check` passes
- [ ] `uv run ruff format` applied
- [ ] `uv run ty check` passes
- [ ] `uv run pytest --cov` >= 50%
