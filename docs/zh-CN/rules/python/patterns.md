---
paths:
  - "**/*.py"
  - "**/*.pyi"
---

# Python 模式

> 本文档扩展了 [common/patterns.md](../common/patterns.md)，补充了 Python 特定的内容。

## 协议（鸭子类型）

```python
from typing import Protocol

class Repository(Protocol):
    def find_by_id(self, id: str) -> dict | None: ...
    def save(self, entity: dict) -> dict: ...
```

## 数据类作为 DTO

```python
from dataclasses import dataclass

@dataclass
class CreateUserRequest:
    name: str
    email: str
    age: int | None = None
```

## 上下文管理器与生成器

* 使用上下文管理器（`with` 语句）进行资源管理
* 使用生成器进行惰性求值和内存高效迭代

## 参考

查看技能：`python-patterns`，了解包括装饰器、并发和包组织在内的综合模式。
