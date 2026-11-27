---
paths:
  - "**/*.py"
  - "**/*.pyi"
---
# Seguridad en Python

> Este archivo extiende [common/security.md](../common/security.md) con contenido específico de Python.

## Gestión de Secretos

```python
import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.environ["OPENAI_API_KEY"]  # Lanza KeyError si falta
```

## Escaneo de Seguridad

- Usar **bandit** para análisis estático de seguridad:
  ```bash
  bandit -r src/
  ```

## Referencia

Ver skill: `django-security` para directrices de seguridad específicas de Django (si aplica).
