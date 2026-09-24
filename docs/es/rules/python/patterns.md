---
paths:
  - "**/*.py"
  - "**/*.pyi"
---
# Patrones de Python

> Este archivo extiende [common/patterns.md](../common/patterns.md) con contenido específico de Python.

## Protocol (Duck Typing)

```python
from typing import Protocol

class Repository(Protocol):
    def find_by_id(self, id: str) -> dict | None: ...
    def save(self, entity: dict) -> dict: ...
```

## Dataclasses como DTOs

```python
from dataclasses import dataclass

@dataclass
class CreateUserRequest:
    name: str
    email: str
    age: int | None = None
```

## Context Managers y Generadores

- Usar context managers (sentencia `with`) para gestión de recursos
- Usar generadores para evaluación lazy e iteración eficiente en memoria

## Referencia

Ver skill: `python-patterns` para patrones completos incluyendo decoradores, concurrencia y organización de paquetes.
