---
paths:
  - "**/*.py"
  - "**/*.pyi"
---
# Python テスト

> このファイルは [common/testing.md](../common/testing.md) を Python 固有のコンテンツで拡張します。

## フレームワーク

テストフレームワークとして **pytest** を使用する。

## カバレッジ

```bash
pytest --cov=src --cov-report=term-missing
```

## テストの構成

テスト分類には `pytest.mark` を使用する:

```python
import pytest

@pytest.mark.unit
def test_calculate_total():
    ...

@pytest.mark.integration
def test_database_connection():
    ...
```

## リファレンス

スキル: `python-testing` で詳細な pytest パターンとフィクスチャを参照してください。
