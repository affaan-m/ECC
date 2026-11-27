---
name: python-patterns
description: >
  Python-specific design patterns and best practices including protocols,
  dataclasses, context managers, decorators, async/await, type hints, and
  package organization. Use when working with Python code to apply Pythonic
  patterns.
metadata:
  origin: ECC
  globs: ["**/*.py", "**/*.pyi"]
---

# Python Patterns

> This skill provides comprehensive Python patterns extending common design principles with Python-specific idioms.

## Protocol (Duck Typing)

Use `Protocol` for structural subtyping (duck typing with type hints):

```python
from typing import Protocol

class Repository(Protocol):
    def find_by_id(self, id: str) -> dict | None: ...
    def save(self, entity: dict) -> dict: ...

# Any class with these methods satisfies the protocol
class UserRepository:
    def find_by_id(self, id: str) -> dict | None:
        # implementation
        pass

    def save(self, entity: dict) -> dict:
        # implementation
        pass

def process_entity(repo: Repository, id: str) -> None:
    entity = repo.find_by_id(id)
    # ... process
```

**Benefits:**
- Type safety without inheritance
- Flexible, loosely coupled code
- Easy testing and mocking

## Dataclasses as DTOs

Use `dataclass` for data transfer objects and value objects:

```python
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class CreateUserRequest:
    name: str
    email: str
    age: Optional[int] = None
    tags: list[str] = field(default_factory=list)

@dataclass(frozen=True)
class User:
    """Immutable user entity"""
    id: str
    name: str
    email: str
```

**Features:**
- Auto-generated `__init__`, `__repr__`, `__eq__`
- `frozen=True` for immutability
- `field()` for complex defaults
- Type hints for validation

## Context Managers

Use context managers (`with` statement) for resource management:

```python
from contextlib import contextmanager
from typing import Generator

@contextmanager
def database_transaction(db) -> Generator[None, None, None]:
    """Context manager for database transactions"""
    try:
        yield
        db.commit()
    except Exception:
        db.rollback()
        raise

# Usage
with database_transaction(db):
    db.execute("INSERT INTO users ...")
```

**Class-based context manager:**

```python
class FileProcessor:
    def __init__(self, filename: str):
        self.filename = filename
        self.file = None

    def __enter__(self):
        self.file = open(self.filename, 'r')
        return self.file

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.file:
            self.file.close()
        return False  # Don't suppress exceptions
```

## Generators

Use generators for lazy evaluation and memory-efficient iteration:

```python
def read_large_file(filename: str):
    """Generator for reading large files line by line"""
    with open(filename, 'r') as f:
        for line in f:
            yield line.strip()

# Memory-efficient processing
for line in read_large_file('huge.txt'):
    process(line)
```

**Generator expressions:**

```python
# Instead of list comprehension
squares = (x**2 for x in range(1000000))  # Lazy evaluation

# Pipeline pattern
numbers = (x for x in range(100))
evens = (x for x in numbers if x % 2 == 0)
squares = (x**2 for x in evens)
```

## Decorators

### Function Decorators

```python
from functools import wraps
import time

def timing(func):
    """Decorator to measure execution time"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        start = time.time()
        result = func(*args, **kwargs)
        end = time.time()
        print(f"{func.__name__} took {end - start:.2f}s")
        return result
    return wrapper

@timing
def slow_function():
    time.sleep(1)
```

### Class Decorators

```python
def singleton(cls):
    """Decorator to make a class a singleton"""
    instances = {}

    @wraps(cls)
    def get_instance(*args, **kwargs):
        if cls not in instances:
            instances[cls] = cls(*args, **kwargs)
        return instances[cls]

    return get_instance

@singleton
class Config:
    pass
```

## Async/Await

### Async Functions

```python
import asyncio
from typing import List

async def fetch_user(user_id: str) -> dict:
    """Async function for I/O-bound operations"""
    await asyncio.sleep(0.1)  # Simulate network call
    return {"id": user_id, "name": "Alice"}

async def fetch_all_users(user_ids: List[str]) -> List[dict]:
    """Concurrent execution with asyncio.gather"""
    tasks = [fetch_user(uid) for uid in user_ids]
    return await asyncio.gather(*tasks)

# Run async code
asyncio.run(fetch_all_users(["1", "2", "3"]))
```

### Async Context Managers

```python
class AsyncDatabase:
    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.disconnect()

async with AsyncDatabase() as db:
    await db.query("SELECT * FROM users")
```

## Type Hints

### Advanced Type Hints

```python
from typing import TypeVar, Generic, Callable, ParamSpec, Concatenate

T = TypeVar('T')
P = ParamSpec('P')

class Repository(Generic[T]):
    """Generic repository pattern"""
    def __init__(self, entity_type: type[T]):
        self.entity_type = entity_type

    def find_by_id(self, id: str) -> T | None:
        # implementation
        pass

# Type-safe decorator
def log_call(func: Callable[P, T]) -> Callable[P, T]:
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
        print(f"Calling {func.__name__}")
        return func(*args, **kwargs)
    return wrapper
```

### Union Types (Python 3.10+)

```python
def process(value: str | int | None) -> str:
    match value:
        case str():
            return value.upper()
        case int():
            return str(value)
        case None:
            return "empty"
```

## Dependency Injection

### Constructor Injection

```python
class UserService:
    def __init__(
        self,
        repository: Repository,
        logger: Logger,
        cache: Cache | None = None
    ):
        self.repository = repository
        self.logger = logger
        self.cache = cache

    def get_user(self, user_id: str) -> User | None:
        if self.cache:
            cached = self.cache.get(user_id)
            if cached:
                return cached

        user = self.repository.find_by_id(user_id)
        if user and self.cache:
            self.cache.set(user_id, user)

        return user
```

## Package Organization

### Project Structure

```
project/
├── src/
│   └── mypackage/
│       ├── __init__.py
│       ├── domain/          # Business logic
│       │   ├── __init__.py
│       │   └── models.py
│       ├── services/        # Application services
│       │   ├── __init__.py
│       │   └── user_service.py
│       └── infrastructure/  # External dependencies
│           ├── __init__.py
│           └── database.py
├── tests/
│   ├── unit/
│   └── integration/
├── pyproject.toml
└── README.md
```

### Module Exports

```python
# __init__.py
from .models import User, Product
from .services import UserService

__all__ = ['User', 'Product', 'UserService']
```

## Error Handling

### Custom Exceptions

```python
class DomainError(Exception):
    """Base exception for domain errors"""
    pass

class UserNotFoundError(DomainError):
    """Raised when user is not found"""
    def __init__(self, user_id: str):
        self.user_id = user_id
        super().__init__(f"User {user_id} not found")

class ValidationError(DomainError):
    """Raised when validation fails"""
    def __init__(self, field: str, message: str):
        self.field = field
        self.message = message
        super().__init__(f"{field}: {message}")
```

### Exception Groups (Python 3.11+)

```python
try:
    # Multiple operations
    pass
except* ValueError as eg:
    # Handle all ValueError instances
    for exc in eg.exceptions:
        print(f"ValueError: {exc}")
except* TypeError as eg:
    # Handle all TypeError instances
    for exc in eg.exceptions:
        print(f"TypeError: {exc}")
```

## Property Decorators

```python
class User:
    def __init__(self, name: str):
        self._name = name
        self._email = None

    @property
    def name(self) -> str:
        """Read-only property"""
        return self._name

    @property
    def email(self) -> str | None:
        return self._email

    @email.setter
    def email(self, value: str) -> None:
        if '@' not in value:
            raise ValueError("Invalid email")
        self._email = value
```

## Functional Programming

### Higher-Order Functions

```python
from functools import reduce
from typing import Callable, TypeVar

T = TypeVar('T')
U = TypeVar('U')

def pipe(*functions: Callable) -> Callable:
    """Compose functions left to right"""
    def inner(arg):
        return reduce(lambda x, f: f(x), functions, arg)
    return inner

# Usage
process = pipe(
    str.strip,
    str.lower,
    lambda s: s.replace(' ', '_')
)
result = process("  Hello World  ")  # "hello_world"
```

## When to Use This Skill

- Designing Python APIs and packages
- Implementing async/concurrent systems
- Structuring Python projects
- Writing Pythonic code
- Refactoring Python codebases
- Type-safe Python development
