---
name: django-verification
description: "Django项目的验证循环：迁移、代码检查、带覆盖率的测试、安全扫描，以及在发布或PR前的部署就绪检查。"
origin: ECC
---

# Django 验证循环

在发起 PR 之前、进行重大更改之后以及部署之前运行，以确保 Django 应用程序的质量和安全性。

## 何时激活

* 在为一个 Django 项目开启拉取请求之前
* 在重大模型变更、迁移更新或依赖升级之后
* 用于暂存或生产环境的预部署验证
* 运行完整的环境 → 代码检查 → 测试 → 安全 → 部署就绪流水线时
* 验证迁移安全性和测试覆盖率时

## 阶段 1: 环境检查

```bash
# Verify Python version
python --version  # Should match project requirements

# Check virtual environment
which python
pip list --outdated

# Verify environment variables
python -c "import os; import environ; print('DJANGO_SECRET_KEY set' if os.environ.get('DJANGO_SECRET_KEY') else 'MISSING: DJANGO_SECRET_KEY')"
```

如果环境配置错误，请停止并修复。

## 阶段 2: 代码质量与格式化

```bash
# Type checking
mypy . --config-file pyproject.toml

# Linting with ruff
ruff check . --fix

# Formatting with black
black . --check
black .  # Auto-fix

# Import sorting
isort . --check-only
isort .  # Auto-fix

# Django-specific checks
python manage.py check --deploy
```

常见问题：

* 公共函数缺少类型提示
* 违反 PEP 8 格式规范
* 导入未排序
* 生产配置中遗留调试设置

## 阶段 3: 数据库迁移

```bash
# Check for unapplied migrations
python manage.py showmigrations

# Create missing migrations
python manage.py makemigrations --check

# Dry-run migration application
python manage.py migrate --plan

# Apply migrations (test environment)
python manage.py migrate

# Check for migration conflicts
python manage.py makemigrations --merge  # Only if conflicts exist
```

报告：

* 待应用的迁移数量
* 任何迁移冲突
* 模型更改未生成迁移

## 阶段 4: 测试与覆盖率

```bash
# Run all tests with pytest
pytest --cov=apps --cov-report=html --cov-report=term-missing --reuse-db

# Run specific app tests
pytest apps/users/tests/

# Run with markers
pytest -m "not slow"  # Skip slow tests
pytest -m integration  # Only integration tests

# Coverage report
open htmlcov/index.html
```

报告：

* 总测试数：X 通过，Y 失败，Z 跳过
* 总体覆盖率：XX%
* 按应用划分的覆盖率明细

覆盖率目标：

| 组件 | 目标 |
|-----------|--------|
| 模型 | 90%+ |
| 序列化器 | 85%+ |
| 视图 | 80%+ |
| 服务 | 90%+ |
| 总体 | 80%+ |

## 阶段 5: 安全扫描

```bash
# Dependency vulnerabilities
pip-audit
safety check --full-report

# Django security checks
python manage.py check --deploy

# Bandit security linter
bandit -r . -f json -o bandit-report.json

# Secret scanning (if gitleaks is installed)
gitleaks detect --source . --verbose

# Environment variable check
python -c "from django.core.exceptions import ImproperlyConfigured; from django.conf import settings; settings.DEBUG"
```

报告：

* 发现易受攻击的依赖项
* 安全配置问题
* 检测到硬编码的密钥
* DEBUG 模式状态（生产环境中应为 False）

## 阶段 6: Django 管理命令

```bash
# Check for model issues
python manage.py check

# Collect static files
python manage.py collectstatic --noinput --clear

# Create superuser (if needed for tests)
echo "from apps.users.models import User; User.objects.create_superuser('admin@example.com', 'admin')" | python manage.py shell

# Database integrity
python manage.py check --database default

# Cache verification (if using Redis)
python -c "from django.core.cache import cache; cache.set('test', 'value', 10); print(cache.get('test'))"
```

## 阶段 7: 性能检查

```bash
# Django Debug Toolbar output (check for N+1 queries)
# Run in dev mode with DEBUG=True and access a page
# Look for duplicate queries in SQL panel

# Query count analysis
django-admin debugsqlshell  # If django-debug-sqlshell installed

# Check for missing indexes
python manage.py shell << EOF
from django.db import connection
with connection.cursor() as cursor:
    cursor.execute("SELECT table_name, index_name FROM information_schema.statistics WHERE table_schema = 'public'")
    print(cursor.fetchall())
EOF
```

报告：

* 每页查询次数（典型页面应 < 50）
* 缺少数据库索引
* 检测到重复查询

## 阶段 8: 静态资源

```bash
# Check for npm dependencies (if using npm)
npm audit
npm audit fix

# Build static files (if using webpack/vite)
npm run build

# Verify static files
ls -la staticfiles/
python manage.py findstatic css/style.css
```

## 阶段 9: 配置审查

```python
# Run in Python shell to verify settings
python manage.py shell << EOF
from django.conf import settings
import os

# Critical checks
checks = {
    'DEBUG is False': not settings.DEBUG,
    'SECRET_KEY set': bool(settings.SECRET_KEY and len(settings.SECRET_KEY) > 30),
    'ALLOWED_HOSTS set': len(settings.ALLOWED_HOSTS) > 0,
    'HTTPS enabled': getattr(settings, 'SECURE_SSL_REDIRECT', False),
    'HSTS enabled': getattr(settings, 'SECURE_HSTS_SECONDS', 0) > 0,
    'Database configured': settings.DATABASES['default']['ENGINE'] != 'django.db.backends.sqlite3',
}

for check, result in checks.items():
    status = '✓' if result else '✗'
    print(f"{status} {check}")
EOF
```

## 阶段 10: 日志配置

```bash
# Test logging output
python manage.py shell << EOF
import logging
logger = logging.getLogger('django')
logger.warning('Test warning message')
logger.error('Test error message')
EOF

# Check log files (if configured)
tail -f /var/log/django/django.log
```

## 阶段 11: API 文档（如果使用 DRF）

```bash
# Generate schema
python manage.py generateschema --format openapi-json > schema.json

# Validate schema
# Check if schema.json is valid JSON
python -c "import json; json.load(open('schema.json'))"

# Access Swagger UI (if using drf-yasg)
# Visit http://localhost:8000/swagger/ in browser
```

## 阶段 12: 差异审查

```bash
# Show diff statistics
git diff --stat

# Show actual changes
git diff

# Show changed files
git diff --name-only

# Check for common issues
git diff | grep -i "todo\|fixme\|hack\|xxx"
git diff | grep "print("  # Debug statements
git diff | grep "DEBUG = True"  # Debug mode
git diff | grep "import pdb"  # Debugger
```

检查清单：

* 无调试语句（print, pdb, breakpoint()）
* 关键代码中无 TODO/FIXME 注释
* 无硬编码的密钥或凭证
* 模型更改包含数据库迁移
* 配置更改已记录
* 外部调用存在错误处理
* 需要时已进行事务管理

## 输出模板

```
DJANGO 验证报告
==========================

阶段 1：环境检查
  ✓ Python 3.11.5
  ✓ 虚拟环境已激活
  ✓ 所有环境变量已设置

阶段 2：代码质量
  ✓ mypy: 无类型错误
  ✗ ruff: 发现 3 个问题（已自动修复）
  ✓ black: 无格式问题
  ✓ isort: 导入已正确排序
  ✓ manage.py check: 无问题

阶段 3：数据库迁移
  ✓ 无未应用的迁移
  ✓ 无迁移冲突
  ✓ 所有模型均有对应的迁移文件

阶段 4：测试与覆盖率
  测试：247 通过，0 失败，5 跳过
  覆盖率：
    总计：87%
    users: 92%
    products: 89%
    orders: 85%
    payments: 91%

阶段 5：安全扫描
  ✗ pip-audit: 发现 2 个漏洞（需要修复）
  ✓ safety check: 无问题
  ✓ bandit: 无安全问题
  ✓ 未检测到密钥泄露
  ✓ DEBUG = False

阶段 6：Django 命令
  ✓ collectstatic 完成
  ✓ 数据库完整性正常
  ✓ 缓存后端可访问

阶段 7：性能
  ✓ 未检测到 N+1 查询
  ✓ 数据库索引已配置
  ✓ 查询数量可接受

阶段 8：静态资源
  ✓ npm audit: 无漏洞
  ✓ 资源构建成功
  ✓ 静态文件已收集

阶段 9：配置
  ✓ DEBUG = False
  ✓ SECRET_KEY 已配置
  ✓ ALLOWED_HOSTS 已设置
  ✓ HTTPS 已启用
  ✓ HSTS 已启用
  ✓ 数据库已配置

阶段 10：日志
  ✓ 日志配置完成
  ✓ 日志文件可写入

阶段 11：API 文档
  ✓ 架构已生成
  ✓ Swagger UI 可访问

阶段 12：差异审查
  文件变更：12
  行数变化：+450, -120
  ✓ 无调试语句
  ✓ 无硬编码密钥
  ✓ 包含迁移文件

建议：WARNING: 部署前修复 pip-audit 发现的漏洞

后续步骤：
1. 更新存在漏洞的依赖项
2. 重新运行安全扫描
3. 部署到预发布环境进行最终测试
```

## 预部署检查清单

* \[ ] 所有测试通过
* \[ ] 覆盖率 ≥ 80%
* \[ ] 无安全漏洞
* \[ ] 无未应用的迁移
* \[ ] 生产设置中 DEBUG = False
* \[ ] SECRET\_KEY 已正确配置
* \[ ] ALLOWED\_HOSTS 设置正确
* \[ ] 数据库备份已启用
* \[ ] 静态文件已收集并提供服务
* \[ ] 日志配置正常且有效
* \[ ] 错误监控（Sentry 等）已配置
* \[ ] CDN 已配置（如果适用）
* \[ ] Redis/缓存后端已配置
* \[ ] Celery 工作进程正在运行（如果适用）
* \[ ] HTTPS/SSL 已配置
* \[ ] 环境变量已记录

## 持续集成

### GitHub Actions 示例

```yaml
# .github/workflows/django-verification.yml
name: Django Verification

on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'

      - name: Cache pip
        uses: actions/cache@v3
        with:
          path: ~/.cache/pip
          key: ${{ runner.os }}-pip-${{ hashFiles('**/requirements.txt') }}

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install ruff black mypy pytest pytest-django pytest-cov bandit safety pip-audit

      - name: Code quality checks
        run: |
          ruff check .
          black . --check
          isort . --check-only
          mypy .

      - name: Security scan
        run: |
          bandit -r . -f json -o bandit-report.json
          safety check --full-report
          pip-audit

      - name: Run tests
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/test
          DJANGO_SECRET_KEY: test-secret-key
        run: |
          pytest --cov=apps --cov-report=xml --cov-report=term-missing

      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

## 快速参考

| 检查项 | 命令 |
|-------|---------|
| 环境 | `python --version` |
| 类型检查 | `mypy .` |
| 代码检查 | `ruff check .` |
| 格式化 | `black . --check` |
| 迁移 | `python manage.py makemigrations --check` |
| 测试 | `pytest --cov=apps` |
| 安全 | `pip-audit && bandit -r .` |
| Django 检查 | `python manage.py check --deploy` |
| 收集静态文件 | `python manage.py collectstatic --noinput` |
| 差异统计 | `git diff --stat` |

请记住：自动化验证可以发现常见问题，但不能替代在预发布环境中的手动代码审查和测试。
