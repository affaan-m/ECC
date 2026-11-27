---
paths:
  - "**/*.py"
  - "**/*.pyi"
---
# Pruebas en Python

> Este archivo extiende [common/testing.md](../common/testing.md) con contenido específico de Python.

## Framework

Usar **pytest** como framework de pruebas.

## Cobertura

```bash
pytest --cov=src --cov-report=term-missing
```

## Organización de Pruebas

Usar `pytest.mark` para categorización de pruebas:

```python
import pytest

@pytest.mark.unit
def test_calculate_total():
    ...

@pytest.mark.integration
def test_database_connection():
    ...
```

## Referencia

Ver skill: `python-testing` para patrones detallados de pytest y fixtures.
