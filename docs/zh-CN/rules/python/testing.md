---
paths:
  - "**/*.py"
  - "**/*.pyi"
---

# Python 测试

> 本文件在 [通用/测试.md](../common/testing.md) 的基础上扩展了 Python 特定的内容。

## 框架

使用 **pytest** 作为测试框架。

## 覆盖率

```bash
pytest --cov=src --cov-report=term-missing
```

## 测试组织

使用 `pytest.mark` 进行测试分类：

```python
import pytest

@pytest.mark.unit
def test_calculate_total():
    ...

@pytest.mark.integration
def test_database_connection():
    ...
```

## 参考

查看技能：`python-testing` 以获取详细的 pytest 模式和夹具信息。
