---
paths:
  - "**/*.py"
  - "**/*.pyi"
---
# Estilo de Código en Python

> Este archivo extiende [common/coding-style.md](../common/coding-style.md) con contenido específico de Python.

## Estándares

- Seguir las convenciones de **PEP 8**
- Usar **anotaciones de tipos** en todas las firmas de funciones

## Inmutabilidad

Preferir estructuras de datos inmutables:

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

## Formateo

- **black** para formateo de código
- **isort** para ordenamiento de imports
- **ruff** para linting

## Referencia

Ver skill: `python-patterns` para idiomas y patrones completos de Python.
