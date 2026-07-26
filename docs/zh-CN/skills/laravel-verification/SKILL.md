---
name: laravel-verification
description: "Verification loop for Laravel projects: env checks, linting, static analysis, tests with coverage, security scans, and deployment readiness."
origin: ECC
---

# Laravel 验证循环

在发起 PR 前、进行重大更改后以及部署前运行。

## 使用时机

* 在为一个 Laravel 项目开启拉取请求之前
* 在重大重构或依赖升级之后
* 为预生产或生产环境进行部署前验证
* 运行完整的 代码检查 -> 测试 -> 安全检查 -> 部署就绪 流水线

## 工作原理

* 按顺序运行从环境检查到部署就绪的各个阶段，每一层都建立在前一层的基础上。
* 环境和 Composer 检查是所有其他步骤的关卡；如果它们失败，立即停止。
* 代码检查/静态分析应在运行完整测试和覆盖率检查前确保通过。
* 安全性和迁移审查在测试之后进行，以便在涉及数据或发布步骤之前验证行为。
* 构建/部署就绪以及队列/调度器检查是最后的关卡；任何失败都会阻止发布。

## 第一阶段：环境检查

```bash
php -v
composer --version
php artisan --version
```

* 验证 `.env` 文件存在且包含必需的键
* 确认生产环境已设置 `APP_DEBUG=false`
* 确认 `APP_ENV` 与目标部署环境匹配（`production`、`staging`）

如果在本地使用 Laravel Sail：

```bash
./vendor/bin/sail php -v
./vendor/bin/sail artisan --version
```

## 第一阶段补充：Composer 和自动加载

```bash
composer validate
composer dump-autoload -o
```

## 第二阶段：代码检查和静态分析

```bash
vendor/bin/pint --test
vendor/bin/phpstan analyse
```

如果你的项目使用 Psalm 而不是 PHPStan：

```bash
vendor/bin/psalm
```

## 第三阶段：测试和覆盖率

```bash
php artisan test
```

覆盖率（CI 环境）：

```bash
XDEBUG_MODE=coverage php artisan test --coverage
```

CI 示例（格式化 -> 静态分析 -> 测试）：

```bash
vendor/bin/pint --test
vendor/bin/phpstan analyse
XDEBUG_MODE=coverage php artisan test --coverage
```

## 第四阶段：安全和依赖项检查

```bash
composer audit
```

## 第五阶段：数据库和迁移

```bash
php artisan migrate --pretend
php artisan migrate:status
```

* 仔细审查破坏性迁移
* 确保迁移文件名遵循 `Y_m_d_His_*` 格式（例如，`2025_03_14_154210_create_orders_table.php`）并清晰地描述变更
* 确保可以执行回滚
* 验证 `down()` 方法，避免在没有明确备份的情况下造成不可逆的数据丢失

## 第六阶段：构建和部署就绪

```bash
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

* 确保在生产配置下缓存预热成功
* 验证队列工作者和调度器已配置
* 确认在目标环境中 `storage/` 和 `bootstrap/cache/` 目录可写

## 第七阶段：队列和调度器检查

```bash
php artisan schedule:list
php artisan queue:failed
```

如果使用了 Horizon：

```bash
php artisan horizon:status
```

如果 `queue:monitor` 命令可用，可以用它来检查积压作业而无需处理它们：

```bash
php artisan queue:monitor default --max=100
```

主动验证（仅限预生产环境）：向一个专用队列分发一个无操作作业，并运行一个单独的工作者来处理它（确保配置了一个非 `sync` 的队列连接）。

```bash
php artisan tinker --execute="dispatch((new App\\Jobs\\QueueHealthcheck())->onQueue('healthcheck'))"
php artisan queue:work --once --queue=healthcheck
```

验证该作业产生了预期的副作用（日志条目、健康检查表行或指标）。

仅在处理测试作业是安全的非生产环境中运行此检查。

## 示例

最小流程：

```bash
php -v
composer --version
php artisan --version
composer validate
vendor/bin/pint --test
vendor/bin/phpstan analyse
php artisan test
composer audit
php artisan migrate --pretend
php artisan config:cache
php artisan queue:failed
```

CI 风格流水线：

```bash
composer validate
composer dump-autoload -o
vendor/bin/pint --test
vendor/bin/phpstan analyse
XDEBUG_MODE=coverage php artisan test --coverage
composer audit
php artisan migrate --pretend
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan schedule:list
```
