---
paths:
  - "**/*.pl"
  - "**/*.pm"
  - "**/*.t"
  - "**/*.psgi"
  - "**/*.cgi"
---

# Perl 测试

> 本文档在 [common/testing.md](../common/testing.md) 的基础上扩展了针对 Perl 的内容。

## 框架

在新项目中使用 **Test2::V0**（而非 Test::More）：

```perl
use Test2::V0;

is($result, 42, 'answer is correct');

done_testing;
```

## 测试运行器

```bash
prove -l t/              # adds lib/ to @INC
prove -lr -j8 t/         # recursive, 8 parallel jobs
```

始终使用 `-l` 以确保 `lib/` 位于 `@INC` 上。

## 覆盖率

使用 **Devel::Cover** —— 目标覆盖率 80%+：

```bash
cover -test
```

## 模拟

* **Test::MockModule** —— 模拟现有模块上的方法
* **Test::MockObject** —— 从头创建测试替身

## 常见陷阱

* 测试文件末尾始终使用 `done_testing`
* 使用 `prove` 时切勿忘记 `-l` 标志

## 参考

有关使用 Test2::V0、prove 和 Devel::Cover 的详细 Perl TDD 模式，请参阅技能：`perl-testing`。
