---
paths:
  - "**/*.py"
  - "**/*.pyi"
---
# Python Pattern'leri

> Bu dosya [common/patterns.md](../common/patterns.md) dosyasını Python'a özgü içerikle genişletir.

## Protocol (Duck Typing)

```python
from typing import Protocol

class Repository(Protocol):
    def find_by_id(self, id: str) -> dict | None: ...
    def save(self, entity: dict) -> dict: ...
```

## DTO'lar olarak Dataclass'lar

```python
from dataclasses import dataclass

@dataclass
class CreateUserRequest:
    name: str
    email: str
    age: int | None = None
```

## Context Manager'lar & Generator'lar

- Kaynak yönetimi için context manager'ları (`with` ifadesi) kullan
- Lazy evaluation ve bellek verimli iterasyon için generator'ları kullan

## Referans

Decorator'lar, concurrency ve paket organizasyonu dahil kapsamlı pattern'ler için skill: `python-patterns` dosyasına bakın.
