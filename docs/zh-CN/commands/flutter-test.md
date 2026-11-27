---
description: 运行Flutter/Dart测试，报告失败，并逐步修复测试问题。涵盖单元测试、组件测试、黄金测试和集成测试。
---

# Flutter 测试

此命令运行 Flutter 测试套件并报告结果。当出现失败时，会逐步诊断并修复问题。

## 此命令的功能

1. **运行测试**：执行 `flutter test`（或限定范围至已更改文件）
2. **解析失败项**：按类型和原因识别失败测试
3. **逐步修复**：尽可能每次只修复一个失败项
4. **验证**：每次修复后重新运行
5. **报告**：显示覆盖率摘要和剩余失败项

## 使用时机

在以下情况使用 `/flutter-test`：

* 实现功能后验证未破坏现有功能
* 运行 `/flutter-build` 后确保测试通过
* 检查新代码的测试覆盖率
* 特定测试文件失败时
* 提交 PR 前

## 执行的命令

```bash
# Run all tests
flutter test 2>&1

# Run with coverage
flutter test --coverage 2>&1

# Run specific test file
flutter test test/unit/domain/usecases/get_user_test.dart 2>&1

# Run tests matching a name pattern
flutter test --name "CartBloc" 2>&1

# Run integration tests (requires device/emulator)
flutter test integration_test/ 2>&1

# Update golden files when intentional visual changes are made
flutter test --update-goldens 2>&1
```

## 示例会话

````text
用户：/flutter-test

代理：
# Flutter 测试运行

## 测试执行

```
$ flutter test
00:05 +42 -2: 部分测试失败。

失败：test/unit/data/user_repository_test.dart
  UserRepository getById
    当用户未找到时返回 null
    期望：null
    实际：User(id: 'test-id', name: 'Test User')

失败：test/widget/cart_page_test.dart
  CartPage
    购物车为空时显示空状态
    期望：恰好一个包含文本 'Your cart is empty' 的组件
    找到：没有包含文本 'Your cart is empty' 的组件
```

## 修复 1：仓库测试

文件：test/unit/data/user_repository_test.dart
失败：`getById` 在应返回 null 时返回了一个用户（针对缺失的 ID）

根本原因：测试设置添加了一个 ID 为 'test-id' 的用户，但查询时使用了 'missing-id'。
修复：更新测试以查询 'missing-id' —— 设置是正确的，查询是错误的。

```
$ flutter test test/unit/data/user_repository_test.dart
1 个测试通过。
```

## 修复 2：组件测试

文件：test/widget/cart_page_test.dart
失败：未找到空状态文本组件

根本原因：组件中的空状态消息已从 'Your cart is empty' 重命名为 'Cart is empty'。
修复：更新测试字符串以匹配当前组件文案。

```
$ flutter test test/widget/cart_page_test.dart
1 个测试通过。
```

## 最终运行

```
$ flutter test --coverage
全部 44 个测试通过。
覆盖率：84.2%（目标：80%）
```

## 总结

| 指标 | 值 |
|--------|-------|
| 总测试数 | 44 |
| 通过 | 44 |
| 失败 | 0 |
| 覆盖率 | 84.2% |

测试状态：通过 ✓
````

## 常见测试失败项

| 失败类型 | 典型修复方法 |
|---------|-------------|
| `Expected: <X> Actual: <Y>` | 更新断言或修复实现 |
| `Widget not found` | 修复查找器选择器或组件重命名后更新测试 |
| `Golden file not found` | 运行 `flutter test --update-goldens` 生成 |
| `Golden mismatch` | 检查差异；若变更有意则运行 `--update-goldens` |
| `MissingPluginException` | 在测试设置中模拟平台通道 |
| `LateInitializationError` | 在 `setUp()` 中初始化 `late` 字段 |
| `pumpAndSettle timed out` | 替换为显式 `pump(Duration)` 调用 |

## 相关命令

* `/flutter-build` — 运行测试前修复构建错误
* `/flutter-review` — 测试通过后审查代码
* `tdd-workflow` 技能 — 测试驱动开发工作流

## 相关内容

* 代理：`agents/flutter-reviewer.md`
* 代理：`agents/dart-build-resolver.md`
* 技能：`skills/flutter-dart-code-review/`
* 规则：`rules/dart/testing.md`
