---
name: python-patterns
description: Pythonic idiomlar, PEP 8 standartları, type hint'ler ve sağlam, verimli ve bakımı kolay Python uygulamaları oluşturmak için en iyi uygulamalar.
origin: ECC
---

# Python Geliştirme Desenleri

Sağlam, verimli ve bakımı kolay uygulamalar oluşturmak için idiomatic Python desenleri ve en iyi uygulamalar.

## Ne Zaman Etkinleştirmeli

- Yeni Python kodu yazarken
- Python kodunu gözden geçirirken
- Mevcut Python kodunu refactor ederken
- Python paketleri/modülleri tasarlarken

## Temel Prensipler

### 1. Okunabilirlik Önemlidir

Python okunabilirliği önceliklendirir. Kod açık ve anlaşılması kolay olmalıdır.

```python
# İyi: Açık ve okunabilir
def get_active_users(users: list[User]) -> list[User]:
    """Sağlanan listeden sadece aktif kullanıcıları döndür."""
    return [user for user in users if user.is_active]


# Kötü: Zeki ama kafa karıştırıcı
def get_active_users(u):
    return [x for x in u if x.a]
```

### 2. Açık, Örtük Olandan Daha İyidir

Sihirden kaçının; kodunuzun ne yaptığı konusunda açık olun.

```python
# İyi: Açık yapılandırma
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Kötü: Gizli yan etkiler
import some_module
some_module.setup()  # Bu ne yapıyor?
```

### 3. EAFP - Affederek Sormaktansa İzin İstemek Daha Kolaydır

Python, koşulları kontrol etmek yerine exception handling'i tercih eder.

```python
# İyi: EAFP stili
def get_value(dictionary: dict, key: str, default_value: Any = None) -> Any:
    try:
        return dictionary[key]
    except KeyError:
        return default_value

# Kötü: LBYL (Atlamadan Önce Bak) stili
def get_value(dictionary: dict, key: str, default_value: Any = None) -> Any:
    if key in dictionary:
        return dictionary[key]
    else:
        return default_value
```

## Type Hint'ler

### Temel Type Annotation'lar

```python
from typing import Optional, List, Dict, Any

def process_user(
    user_id: str,
    data: Dict[str, Any],
    active: bool = True
) -> Optional[User]:
    """Bir kullanıcıyı işle ve güncellenmiş User'ı veya None döndür."""
    if not active:
        return None
    return User(user_id, data)
```

### Modern Type Hint'ler (Python 3.9+)

```python
# Python 3.9+ - Built-in tipleri kullan
def process_items(items: list[str]) -> dict[str, int]:
    return {item: len(item) for item in items}

# Python 3.8 ve öncesi - typing modülünü kullan
from typing import List, Dict

def process_items(items: List[str]) -> Dict[str, int]:
    return {item: len(item) for item in items}
```

### Type Alias'ları ve TypeVar

```python
from typing import TypeVar, Union

# Karmaşık tipler için type alias
JSON = Union[dict[str, Any], list[Any], str, int, float, bool, None]

def parse_json(data: str) -> JSON:
    return json.loads(data)

# Generic tipler
T = TypeVar('T')

def first(items: list[T]) -> T | None:
    """İlk öğeyi döndür veya liste boşsa None döndür."""
    return items[0] if items else None
```

### Protocol Tabanlı Duck Typing

```python
from typing import Protocol

class Renderable(Protocol):
    def render(self) -> str:
        """Nesneyi string'e render et."""

def render_all(items: list[Renderable]) -> str:
    """Renderable protocol'ünü implement eden tüm öğeleri render et."""
    return "\n".join(item.render() for item in items)
```

## Hata İşleme Desenleri

### Spesifik Exception Handling

```python
# İyi: Spesifik exception'ları yakala
def load_config(path: str) -> Config:
    try:
        with open(path) as f:
            return Config.from_json(f.read())
    except FileNotFoundError as e:
        raise ConfigError(f"Config file not found: {path}") from e
    except json.JSONDecodeError as e:
        raise ConfigError(f"Invalid JSON in config: {path}") from e

# Kötü: Bare except
def load_config(path: str) -> Config:
    try:
        with open(path) as f:
            return Config.from_json(f.read())
    except:
        return None  # Sessiz hata!
```

### Exception Chaining

```python
def process_data(data: str) -> Result:
    try:
        parsed = json.loads(data)
    except json.JSONDecodeError as e:
        # Traceback'i korumak için exception'ları zincirleme
        raise ValueError(f"Failed to parse data: {data}") from e
```

### Özel Exception Hiyerarşisi

```python
class AppError(Exception):
    """Tüm uygulama hataları için base exception."""
    pass

class ValidationError(AppError):
    """Input validation başarısız olduğunda raise edilir."""
    pass

class NotFoundError(AppError):
    """İstenen kaynak bulunamadığında raise edilir."""
    pass

# Kullanım
def get_user(user_id: str) -> User:
    user = db.find_user(user_id)
    if not user:
        raise NotFoundError(f"User not found: {user_id}")
    return user
```

## Context Manager'lar

### Kaynak Yönetimi

```python
# İyi: Context manager'ları kullanma
def process_file(path: str) -> str:
    with open(path, 'r') as f:
        return f.read()

# Kötü: Manuel kaynak yönetimi
def process_file(path: str) -> str:
    f = open(path, 'r')
    try:
        return f.read()
    finally:
        f.close()
```

### Özel Context Manager'lar

```python
from contextlib import contextmanager

@contextmanager
def timer(name: str):
    """Bir kod bloğunu zamanlamak için context manager."""
    start = time.perf_counter()
    yield
    elapsed = time.perf_counter() - start
    print(f"{name} took {elapsed:.4f} seconds")

# Kullanım
with timer("data processing"):
    process_large_dataset()
```

### Context Manager Class'ları

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
        return False  # Exception'ları suppress etme

# Kullanım
with DatabaseTransaction(conn):
    user = conn.create_user(user_data)
    conn.create_profile(user.id, profile_data)
```

## Comprehension'lar ve Generator'lar

### List Comprehension'ları

```python
# İyi: Basit dönüşümler için list comprehension
names = [user.name for user in users if user.is_active]

# Kötü: Manuel döngü
names = []
for user in users:
    if user.is_active:
        names.append(user.name)

# Karmaşık comprehension'lar genişletilmelidir
# Kötü: Çok karmaşık
result = [x * 2 for x in items if x > 0 if x % 2 == 0]

# İyi: Bir generator fonksiyonu kullan
def filter_and_transform(items: Iterable[int]) -> list[int]:
    result = []
    for x in items:
        if x > 0 and x % 2 == 0:
            result.append(x * 2)
    return result
```

### Generator Expression'ları

```python
# İyi: Lazy evaluation için generator
total = sum(x * x for x in range(1_000_000))

# Kötü: Büyük ara liste oluşturur
total = sum([x * x for x in range(1_000_000)])
```

### Generator Fonksiyonları

```python
def read_large_file(path: str) -> Iterator[str]:
    """Büyük bir dosyayı satır satır oku."""
    with open(path) as f:
        for line in f:
            yield line.strip()

# Kullanım
for line in read_large_file("huge.txt"):
    process(line)
```

## Data Class'lar ve Named Tuple'lar

### Data Class'lar

```python
from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class User:
    """Otomatik __init__, __repr__ ve __eq__ ile User entity."""
    id: str
    name: str
    email: str
    created_at: datetime = field(default_factory=datetime.now)
    is_active: bool = True

# Kullanım
user = User(
    id="123",
    name="Alice",
    email="alice@example.com"
)
```

### Validation ile Data Class'lar

```python
@dataclass
class User:
    email: str
    age: int

    def __post_init__(self):
        # Email formatını validate et
        if "@" not in self.email:
            raise ValueError(f"Invalid email: {self.email}")
        # Yaş aralığını validate et
        if self.age < 0 or self.age > 150:
            raise ValueError(f"Invalid age: {self.age}")
```

### Named Tuple'lar

```python
from typing import NamedTuple

class Point(NamedTuple):
    """Immutable 2D nokta."""
    x: float
    y: float

    def distance(self, other: 'Point') -> float:
        return ((self.x - other.x) ** 2 + (self.y - other.y) ** 2) ** 0.5

# Kullanım
p1 = Point(0, 0)
p2 = Point(3, 4)
print(p1.distance(p2))  # 5.0
```

## Decorator'lar

### Fonksiyon Decorator'ları

```python
import functools
import time

def timer(func: Callable) -> Callable:
    """Fonksiyon yürütmesini zamanlamak için decorator."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed = time.perf_counter() - start
        print(f"{func.__name__} took {elapsed:.4f}s")
        return result
    return wrapper

@timer
def slow_function():
    time.sleep(1)

# slow_function() yazdırır: slow_function took 1.0012s
```

### Parametreli Decorator'lar

```python
def repeat(times: int):
    """Bir fonksiyonu birden çok kez tekrarlamak için decorator."""
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
    return f"Hello, {name}!"

# greet("Alice") döndürür ["Hello, Alice!", "Hello, Alice!", "Hello, Alice!"]
```

### Class Tabanlı Decorator'lar

```python
class CountCalls:
    """Bir fonksiyonun kaç kez çağrıldığını sayan decorator."""
    def __init__(self, func: Callable):
        functools.update_wrapper(self, func)
        self.func = func
        self.count = 0

    def __call__(self, *args, **kwargs):
        self.count += 1
        print(f"{self.func.__name__} has been called {self.count} times")
        return self.func(*args, **kwargs)

@CountCalls
def process():
    pass

# Her process() çağrısı çağrı sayısını yazdırır
```

## Eşzamanlılık Desenleri

### I/O-Bound Görevler için Threading

```python
import concurrent.futures
import threading

def fetch_url(url: str) -> str:
    """Bir URL fetch et (I/O-bound operasyon)."""
    import urllib.request
    with urllib.request.urlopen(url) as response:
        return response.read().decode()

def fetch_all_urls(urls: list[str]) -> dict[str, str]:
    """Thread'ler kullanarak birden fazla URL'yi eşzamanlı fetch et."""
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

### CPU-Bound Görevler için Multiprocessing

```python
def process_data(data: list[int]) -> int:
    """CPU-yoğun hesaplama."""
    return sum(x ** 2 for x in data)

def process_all(datasets: list[list[int]]) -> list[int]:
    """Birden fazla process kullanarak birden fazla dataset işle."""
    with concurrent.futures.ProcessPoolExecutor() as executor:
        results = list(executor.map(process_data, datasets))
    return results
```

### Eşzamanlı I/O için Async/Await

```python
import asyncio

async def fetch_async(url: str) -> str:
    """Asenkron olarak bir URL fetch et."""
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.text()

async def fetch_all(urls: list[str]) -> dict[str, str]:
    """Birden fazla URL'yi eşzamanlı fetch et."""
    tasks = [fetch_async(url) for url in urls]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return dict(zip(urls, results))
```

## Paket Organizasyonu

### Standart Proje Düzeni

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

### Import Konvansiyonları

```python
# İyi: Import sırası - stdlib, third-party, local
import os
import sys
from pathlib import Path

import requests
from fastapi import FastAPI

from mypackage.models import User
from mypackage.utils import format_name

# İyi: Otomatik import sıralama için isort kullanın
# pip install isort
```

### Paket Export'ları için __init__.py

```python
# mypackage/__init__.py
"""mypackage - Örnek bir Python paketi."""

__version__ = "1.0.0"

# Ana class/fonksiyonları paket seviyesinde export et
from mypackage.models import User, Post
from mypackage.utils import format_name

__all__ = ["User", "Post", "format_name"]
```

## Bellek ve Performans

### Bellek Verimliliği için __slots__ Kullanma

```python
# Kötü: Normal class __dict__ kullanır (daha fazla bellek)
class Point:
    def __init__(self, x: float, y: float):
        self.x = x
        self.y = y

# İyi: __slots__ bellek kullanımını azaltır
class Point:
    __slots__ = ['x', 'y']

    def __init__(self, x: float, y: float):
        self.x = x
        self.y = y
```

### Büyük Veri için Generator

```python
# Kötü: Bellekte tam liste döndürür
def read_lines(path: str) -> list[str]:
    with open(path) as f:
        return [line.strip() for line in f]

# İyi: Satırları birer birer yield eder
def read_lines(path: str) -> Iterator[str]:
    with open(path) as f:
        for line in f:
            yield line.strip()
```

### Döngülerde String Birleştirmekten Kaçının

```python
# Kötü: String immutability nedeniyle O(n²)
result = ""
for item in items:
    result += str(item)

# İyi: join kullanarak O(n)
result = "".join(str(item) for item in items)

# İyi: Oluşturma için StringIO kullanma
from io import StringIO

buffer = StringIO()
for item in items:
    buffer.write(str(item))
result = buffer.getvalue()
```

## Python Tooling Entegrasyonu

### Temel Komutlar

```bash
# Kod formatlama
black .
isort .

# Linting
ruff check .
pylint mypackage/

# Type checking
mypy .

# Test
pytest --cov=mypackage --cov-report=html

# Güvenlik taraması
bandit -r .

# Dependency yönetimi
pip-audit
safety check
```

### pyproject.toml Yapılandırması

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

## Hızlı Referans: Python İfadeleri

| İfade | Açıklama |
|-------|----------|
| EAFP | Affederek Sormaktansa İzin İstemek Daha Kolay |
| Context manager'lar | Kaynak yönetimi için `with` kullan |
| List comprehension'lar | Basit dönüşümler için |
| Generator'lar | Lazy evaluation ve büyük dataset'ler için |
| Type hint'ler | Fonksiyon signature'larını annotate et |
| Dataclass'lar | Auto-generated metodlarla veri container'ları için |
| `__slots__` | Bellek optimizasyonu için |
| f-string'ler | String formatlama için (Python 3.6+) |
| `pathlib.Path` | Path operasyonları için (Python 3.4+) |
| `enumerate` | Döngülerde index-element çiftleri için |

## Kaçınılması Gereken Anti-Desenler

```python
# Kötü: Mutable default argümanlar
def append_to(item, items=[]):
    items.append(item)
    return items

# İyi: None kullan ve yeni liste oluştur
def append_to(item, items=None):
    if items is None:
        items = []
    items.append(item)
    return items

# Kötü: type() ile tip kontrolü
if type(obj) == list:
    process(obj)

# İyi: isinstance kullan
if isinstance(obj, list):
    process(obj)

# Kötü: None ile == ile karşılaştırma
if value == None:
    process()

# İyi: is kullan
if value is None:
    process()

# Kötü: from module import *
from os.path import *

# İyi: Açık import'lar
from os.path import join, exists

# Kötü: Bare except
try:
    risky_operation()
except:
    pass

# İyi: Spesifik exception
try:
    risky_operation()
except SpecificError as e:
    logger.error(f"Operation failed: {e}")
```

__Unutmayın__: Python kodu okunabilir, açık ve en az sürpriz ilkesine uygun olmalıdır. Şüphe duyduğunuzda, açıklığı zekiceden öncelikli kılın.
