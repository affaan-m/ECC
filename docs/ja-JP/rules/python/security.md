---
paths:
  - "**/*.py"
  - "**/*.pyi"
---
# Python セキュリティ

> このファイルは [common/security.md](../common/security.md) を Python 固有のコンテンツで拡張します。

## シークレット管理

```python
import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.environ["OPENAI_API_KEY"]  # 未設定の場合 KeyError を発生
```

## セキュリティスキャン

- **bandit** を使用して静的セキュリティ解析を実行:
  ```bash
  bandit -r src/
  ```

## リファレンス

スキル: `django-security` で Django 固有のセキュリティガイドラインを参照してください（該当する場合）。
