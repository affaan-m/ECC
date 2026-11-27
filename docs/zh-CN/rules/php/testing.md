---
paths:
  - "**/*.php"
  - "**/phpunit.xml"
  - "**/phpunit.xml.dist"
  - "**/composer.json"
---

# PHP 测试

> 本文档在 [common/testing.md](../common/testing.md) 的基础上，补充了 PHP 相关的内容。

## 测试框架

使用 **PHPUnit** 作为默认测试框架。如果项目中配置了 **Pest**，则新测试优先使用 Pest，并避免混合使用框架。

## 覆盖率

```bash
vendor/bin/phpunit --coverage-text
# or
vendor/bin/pest --coverage
```

在 CI 中优先使用 **pcov** 或 **Xdebug**，并将覆盖率阈值设置在 CI 中，而不是作为团队内部的隐性知识。

## 测试组织

* 将快速的单元测试与涉及框架/数据库的集成测试分开。
* 使用工厂/构建器来生成测试数据，而不是手动编写大量的数组。
* 保持 HTTP/控制器测试专注于传输和验证；将业务规则移到服务层级的测试中。

## Inertia

如果项目使用了 Inertia.js，优先使用 `assertInertia` 搭配 `AssertableInertia` 来验证组件名称和属性，而不是原始的 JSON 断言。

## 参考

查看技能：`tdd-workflow` 以了解项目范围内的 RED -> GREEN -> REFACTOR 循环。
查看技能：`laravel-tdd` 以了解 Laravel 特定的测试模式（PHPUnit 和 Pest）。
