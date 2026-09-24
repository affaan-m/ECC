---
name: python-patterns
description: Patrones idiomáticos de Python, estándares PEP 8, type hints y buenas prácticas para construir aplicaciones Python robustas, eficientes y mantenibles.
origin: ECC
---

# Patrones de Desarrollo Python

Patrones idiomáticos de Python y buenas prácticas para construir aplicaciones robustas, eficientes y mantenibles.

## Cuándo Activar

- Escribir código Python nuevo
- Revisar código Python
- Refactorizar código Python existente
- Diseñar paquetes/módulos Python

## Principios Fundamentales

### 1. La Legibilidad Cuenta

Python prioriza la legibilidad. El código debe ser obvio y fácil de entender.

```python
# Bien: Claro y legible
def get_active_users(users: list[User]) -> list[User]:
    """Retorna solo los usuarios activos de la lista proporcionada."""
    return [user for user in users if user.is_active]


# Mal: Inteligente pero confuso
def get_active_users(u):
    return [x for x in u if x.a]
```

### 2. Explícito es Mejor que Implícito

Evitar la magia; ser claro sobre lo que hace el código.

```python
# Bien: Configuración explícita
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Mal: Efectos secundarios ocultos
import some_module
some_module.setup()  # ¿Qué hace esto?
```

### 3. EAFP - Es Más Fácil Pedir Perdón que Permiso

Python prefiere el manejo de excepciones sobre verificar condiciones.

```python
# Bien: Estilo EAFP
def get_value(dictionary: dict, key: str) -> Any:
    try:
        return dictionary[key]
    except KeyError:
        return default_value

# Mal: Estilo LBYL (Look Before You Leap)
def get_value(dictionary: dict, key: str) -> Any:
    if key in dictionary:
        return dictionary[key]
    else:
        return default_value
```

## Type Hints

### Anotaciones de Tipo Básicas

```python
from typing import Optional, List, Dict, Any

def process_user(
    user_id: str,
    data: Dict[str, Any],
    active: bool = True
) -> Optional[User]:
    """Procesa un usuario y retorna el User actualizado o None."""
    if not active:
        return None
    return User(user_id, data)
```

### Type Hints Modernos (Python 3.9+)

```python
# Python 3.9+ - Usar tipos built-in
def process_items(items: list[str]) -> dict[str, int]:
    return {item: len(item) for item in items}

# Python 3.8 y anteriores - Usar módulo typing
from typing import List, Dict

def process_items(items: List[str]) -> Dict[str, int]:
    return {item: len(item) for item in items}
```

### Type Aliases y TypeVar

```python
from typing import TypeVar, Union

# Type alias para tipos complejos
JSON = Union[dict[str, Any], list[Any], str, int, float, bool, None]

def parse_json(data: str) -> JSON:
    return json.loads(data)

# Tipos genéricos
T = TypeVar('T')

def first(items: list[T]) -> T | None:
    """Retorna el primer elemento o None si la lista está vacía."""
    return items[0] if items else None
```

### Duck Typing Basado en Protocol

```python
from typing import Protocol

class Renderable(Protocol):
    def render(self) -> str:
        """Renderiza el objeto a una cadena."""

def render_all(items: list[Renderable]) -> str:
    """Renderiza todos los elementos que implementan el protocolo Renderable."""
    return "\n".join(item.render() for item in items)
```

## Patrones de Manejo de Errores

### Manejo de Excepciones Específicas

```python
# Bien: Capturar excepciones específicas
def load_config(path: str) -> Config:
    try:
        with open(path) as f:
            return Config.from_json(f.read())
    except FileNotFoundError as e:
        raise ConfigError(f"Archivo de config no encontrado: {path}") from e
    except json.JSONDecodeError as e:
        raise ConfigError(f"JSON inválido en config: {path}") from e

# Mal: except desnudo
def load_config(path: str) -> Config:
    try:
        with open(path) as f:
            return Config.from_json(f.read())
    except:
        return None  # ¡Fallo silencioso!
```

### Encadenamiento de Excepciones

```python
def process_data(data: str) -> Result:
    try:
        parsed = json.loads(data)
    except json.JSONDecodeError as e:
        # Encadenar excepciones para preservar el traceback
        raise ValueError(f"Error al parsear datos: {data}") from e
```

### Jerarquía de Excepciones Personalizadas

```python
class AppError(Exception):
    """Excepción base para todos los errores de la aplicación."""
    pass

class ValidationError(AppError):
    """Se lanza cuando falla la validación de entrada."""
    pass

class NotFoundError(AppError):
    """Se lanza cuando no se encuentra un recurso solicitado."""
    pass

# Uso
def get_user(user_id: str) -> User:
    user = db.find_user(user_id)
    if not user:
        raise NotFoundError(f"Usuario no encontrado: {user_id}")
    return user
```

## Context Managers

### Gestión de Recursos

```python
# Bien: Usar context managers
def process_file(path: str) -> str:
    with open(path, 'r') as f:
        return f.read()

# Mal: Gestión manual de recursos
def process_file(path: str) -> str:
    f = open(path, 'r')
    try:
        return f.read()
    finally:
        f.close()
```

### Context Managers Personalizados

```python
from contextlib import contextmanager

@contextmanager
def timer(name: str):
    """Context manager para medir el tiempo de un bloque de código."""
    start = time.perf_counter()
    yield
    elapsed = time.perf_counter() - start
    print(f"{name} tardó {elapsed:.4f} segundos")

# Uso
with timer("procesamiento de datos"):
    process_large_dataset()
```

### Clases Context Manager

```python
class DatabaseTransaction:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        self.connection.begin_transaction()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is None:
            self.connection.commit()
        else:
            self.connection.rollback()
        return False  # No suprimir excepciones

# Uso
with DatabaseTransaction(conn):
    user = conn.create_user(user_data)
    conn.create_profile(user.id, profile_data)
```

## Comprehensions y Generadores

### List Comprehensions

```python
# Bien: List comprehension para transformaciones simples
names = [user.name for user in users if user.is_active]

# Mal: Loop manual
names = []
for user in users:
    if user.is_active:
        names.append(user.name)

# Las comprehensions complejas deben expandirse
# Mal: Demasiado complejo
result = [x * 2 for x in items if x > 0 if x % 2 == 0]

# Bien: Usar una función generadora
def filter_and_transform(items: Iterable[int]) -> list[int]:
    result = []
    for x in items:
        if x > 0 and x % 2 == 0:
            result.append(x * 2)
    return result
```

### Expresiones Generadoras

```python
# Bien: Generador para evaluación lazy
total = sum(x * x for x in range(1_000_000))

# Mal: Crea una lista intermedia grande
total = sum([x * x for x in range(1_000_000)])
```

### Funciones Generadoras

```python
def read_large_file(path: str) -> Iterator[str]:
    """Lee un archivo grande línea por línea."""
    with open(path) as f:
        for line in f:
            yield line.strip()

# Uso
for line in read_large_file("huge.txt"):
    process(line)
```

## Data Classes y Named Tuples

### Data Classes

```python
from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class User:
    """Entidad de usuario con __init__, __repr__ y __eq__ automáticos."""
    id: str
    name: str
    email: str
    created_at: datetime = field(default_factory=datetime.now)
    is_active: bool = True

# Uso
user = User(
    id="123",
    name="Alice",
    email="alice@example.com"
)
```

### Data Classes con Validación

```python
@dataclass
class User:
    email: str
    age: int

    def __post_init__(self):
        # Validar formato de email
        if "@" not in self.email:
            raise ValueError(f"Email inválido: {self.email}")
        # Validar rango de edad
        if self.age < 0 or self.age > 150:
            raise ValueError(f"Edad inválida: {self.age}")
```

### Named Tuples

```python
from typing import NamedTuple

class Point(NamedTuple):
    """Punto 2D inmutable."""
    x: float
    y: float

    def distance(self, other: 'Point') -> float:
        return ((self.x - other.x) ** 2 + (self.y - other.y) ** 2) ** 0.5

# Uso
p1 = Point(0, 0)
p2 = Point(3, 4)
print(p1.distance(p2))  # 5.0
```

## Decoradores

### Decoradores de Función

```python
import functools
import time

def timer(func: Callable) -> Callable:
    """Decorador para medir el tiempo de ejecución de una función."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed = time.perf_counter() - start
        print(f"{func.__name__} tardó {elapsed:.4f}s")
        return result
    return wrapper

@timer
def slow_function():
    time.sleep(1)

# slow_function() imprime: slow_function tardó 1.0012s
```

### Decoradores Parametrizados

```python
def repeat(times: int):
    """Decorador para repetir una función múltiples veces."""
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            results = []
            for _ in range(times):
                results.append(func(*args, **kwargs))
            return results
        return wrapper
    return decorator

@repeat(times=3)
def greet(name: str) -> str:
    return f"¡Hola, {name}!"

# greet("Alice") retorna ["¡Hola, Alice!", "¡Hola, Alice!", "¡Hola, Alice!"]
```

### Decoradores Basados en Clases

```python
class CountCalls:
    """Decorador que cuenta cuántas veces se llama una función."""
    def __init__(self, func: Callable):
        functools.update_wrapper(self, func)
        self.func = func
        self.count = 0

    def __call__(self, *args, **kwargs):
        self.count += 1
        print(f"{self.func.__name__} ha sido llamada {self.count} veces")
        return self.func(*args, **kwargs)

@CountCalls
def process():
    pass

# Cada llamada a process() imprime el conteo de llamadas
```

## Patrones de Concurrencia

### Threading para Tareas I/O-Bound

```python
import concurrent.futures

def fetch_url(url: str) -> str:
    """Obtiene una URL (operación I/O-bound)."""
    import urllib.request
    with urllib.request.urlopen(url) as response:
        return response.read().decode()

def fetch_all_urls(urls: list[str]) -> dict[str, str]:
    """Obtiene múltiples URLs concurrentemente usando hilos."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        future_to_url = {executor.submit(fetch_url, url): url for url in urls}
        results = {}
        for future in concurrent.futures.as_completed(future_to_url):
            url = future_to_url[future]
            try:
                results[url] = future.result()
            except Exception as e:
                results[url] = f"Error: {e}"
    return results
```

### Multiprocessing para Tareas CPU-Bound

```python
def process_data(data: list[int]) -> int:
    """Cómputo intensivo de CPU."""
    return sum(x ** 2 for x in data)

def process_all(datasets: list[list[int]]) -> list[int]:
    """Procesa múltiples datasets usando múltiples procesos."""
    with concurrent.futures.ProcessPoolExecutor() as executor:
        results = list(executor.map(process_data, datasets))
    return results
```

### Async/Await para I/O Concurrente

```python
import asyncio

async def fetch_async(url: str) -> str:
    """Obtiene una URL de forma asíncrona."""
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.text()

async def fetch_all(urls: list[str]) -> dict[str, str]:
    """Obtiene múltiples URLs concurrentemente."""
    tasks = [fetch_async(url) for url in urls]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return dict(zip(urls, results))
```

## Organización de Paquetes

### Layout Estándar del Proyecto

```
myproject/
├── src/
│   └── mypackage/
│       ├── __init__.py
│       ├── main.py
│       ├── api/
│       │   ├── __init__.py
│       │   └── routes.py
│       ├── models/
│       │   ├── __init__.py
│       │   └── user.py
│       └── utils/
│           ├── __init__.py
│           └── helpers.py
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_api.py
│   └── test_models.py
├── pyproject.toml
├── README.md
└── .gitignore
```

### Convenciones de Importación

```python
# Bien: Orden de importación - stdlib, terceros, locales
import os
import sys
from pathlib import Path

import requests
from fastapi import FastAPI

from mypackage.models import User
from mypackage.utils import format_name

# Bien: Usar isort para ordenar importaciones automáticamente
```

### __init__.py para Exportaciones del Paquete

```python
# mypackage/__init__.py
"""mypackage - Un paquete Python de ejemplo."""

__version__ = "1.0.0"

# Exportar clases/funciones principales al nivel del paquete
from mypackage.models import User, Post
from mypackage.utils import format_name

__all__ = ["User", "Post", "format_name"]
```

## Memoria y Rendimiento

### Uso de __slots__ para Eficiencia de Memoria

```python
# Mal: La clase regular usa __dict__ (más memoria)
class Point:
    def __init__(self, x: float, y: float):
        self.x = x
        self.y = y

# Bien: __slots__ reduce el uso de memoria
class Point:
    __slots__ = ['x', 'y']

    def __init__(self, x: float, y: float):
        self.x = x
        self.y = y
```

### Generador para Datos Grandes

```python
# Mal: Retorna la lista completa en memoria
def read_lines(path: str) -> list[str]:
    with open(path) as f:
        return [line.strip() for line in f]

# Bien: Produce líneas una a la vez
def read_lines(path: str) -> Iterator[str]:
    with open(path) as f:
        for line in f:
            yield line.strip()
```

### Evitar la Concatenación de Cadenas en Loops

```python
# Mal: O(n²) debido a la inmutabilidad de cadenas
result = ""
for item in items:
    result += str(item)

# Bien: O(n) usando join
result = "".join(str(item) for item in items)
```

## Integración de Herramientas Python

### Comandos Esenciales

```bash
# Formateo de código
black .
isort .

# Linting
ruff check .
pylint mypackage/

# Verificación de tipos
mypy .

# Pruebas
pytest --cov=mypackage --cov-report=html

# Escaneo de seguridad
bandit -r .

# Gestión de dependencias
pip-audit
safety check
```

### Configuración de pyproject.toml

```toml
[project]
name = "mypackage"
version = "1.0.0"
requires-python = ">=3.9"
dependencies = [
    "requests>=2.31.0",
    "pydantic>=2.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "pytest-cov>=4.1.0",
    "black>=23.0.0",
    "ruff>=0.1.0",
    "mypy>=1.5.0",
]

[tool.black]
line-length = 88
target-version = ['py39']

[tool.ruff]
line-length = 88
select = ["E", "F", "I", "N", "W"]

[tool.mypy]
python_version = "3.9"
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "--cov=mypackage --cov-report=term-missing"
```

## Referencia Rápida: Patrones Python

| Patrón | Descripción |
|--------|-------------|
| EAFP | Es Más Fácil Pedir Perdón que Permiso |
| Context managers | Usar `with` para gestión de recursos |
| List comprehensions | Para transformaciones simples |
| Generadores | Para evaluación lazy y datasets grandes |
| Type hints | Anotar las firmas de funciones |
| Dataclasses | Para contenedores de datos con métodos auto-generados |
| `__slots__` | Para optimización de memoria |
| f-strings | Para formateo de cadenas (Python 3.6+) |
| `pathlib.Path` | Para operaciones de rutas (Python 3.4+) |
| `enumerate` | Para pares índice-elemento en loops |

## Anti-Patrones a Evitar

```python
# Mal: Argumentos por defecto mutables
def append_to(item, items=[]):
    items.append(item)
    return items

# Bien: Usar None y crear nueva lista
def append_to(item, items=None):
    if items is None:
        items = []
    items.append(item)
    return items

# Mal: Verificar tipo con type()
if type(obj) == list:
    process(obj)

# Bien: Usar isinstance
if isinstance(obj, list):
    process(obj)

# Mal: Comparar con None usando ==
if value == None:
    process()

# Bien: Usar is
if value is None:
    process()

# Mal: from module import *
from os.path import *

# Bien: Importaciones explícitas
from os.path import join, exists

# Mal: except desnudo
try:
    risky_operation()
except:
    pass

# Bien: Excepción específica
try:
    risky_operation()
except SpecificError as e:
    logger.error(f"Operación fallida: {e}")
```

__Recuerda__: El código Python debe ser legible, explícito y seguir el principio de la menor sorpresa. Ante la duda, prioriza la claridad sobre la ingeniosidad.
