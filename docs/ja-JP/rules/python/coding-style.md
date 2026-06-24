---
paths:
  - "**/*.py"
  - "**/*.pyi"
---
# Python コーディングスタイル

> このファイルは [common/coding-style.md](../common/coding-style.md) を Python 固有のコンテンツで拡張します。

## 標準

- **PEP 8** 規約に従う
- すべての関数シグネチャに**型アノテーション**を使用する

## 不変性

不変データ構造を優先する:

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

## フォーマット

- **black** — コードフォーマット
- **isort** — インポートの並べ替え
- **ruff** — リンティング

## リファレンス

スキル: `python-patterns` で包括的な Python のイディオムとパターンを参照してください。
