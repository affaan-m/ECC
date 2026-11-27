---
description: 逐步修复 Dart 分析器错误和 Flutter 构建失败。调用 dart-build-resolver 代理进行最小化的精准修复。
---

# Flutter 构建与修复

此命令调用 **dart-build-resolver** 代理，以最小改动增量修复 Dart/Flutter 构建错误。

## 命令功能

1. **运行诊断**：执行 `flutter analyze`、`flutter pub get`
2. **解析错误**：按文件分组并按严重性排序
3. **增量修复**：每次修复一个错误
4. **验证每次修复**：每次更改后重新运行分析
5. **报告摘要**：显示已修复内容和剩余问题

## 使用时机

在以下情况使用 `/flutter-build`：

* `flutter analyze` 报告错误
* `flutter build` 在任何平台失败
* `dart pub get` / `flutter pub get` 因版本冲突失败
* `build_runner` 代码生成失败
* 拉取更改后导致构建中断

## 运行的诊断命令

```bash
# Analysis
flutter analyze 2>&1

# Dependencies
flutter pub get 2>&1

# Code generation (if project uses build_runner)
dart run build_runner build --delete-conflicting-outputs 2>&1

# Platform builds
flutter build apk 2>&1
flutter build web 2>&1
```

## 示例会话

````text
用户：/flutter-build

代理：
# Flutter 构建问题解决

## 初始诊断

```
$ flutter analyze
分析项目中...

  error • lib/features/user/data/user_repository_impl.dart:34:16 •
    类型为 'String?' 的值无法赋值给类型为 'String' 的变量。 •
    invalid_assignment

  error • lib/features/cart/presentation/cart_page.dart:58:5 •
    类型 'List<Item>' 未定义方法 'add'。
    请尝试将名称更正为现有方法的名称，或定义名为 'add' 的方法。 •
    undefined_method

发现 2 个错误。
```

## 修复 1：空安全

文件：lib/features/user/data/user_repository_impl.dart:34
错误：类型为 'String?' 的值无法赋值给类型 'String'

修改前：
```dart
final id = response.id;
```
修改后：
```dart
final id = response.id ?? '';
```

```
$ flutter analyze
发现 1 个错误。
```

## 修复 2：不可变列表

文件：lib/features/cart/presentation/cart_page.dart:58
错误：类型 'List<Item>' 未定义方法 'add'
原因：状态持有不可修改的列表；变更通过 Cubit 进行

修改前：
```dart
state.items.add(item);
```
修改后：
```dart
context.read<CartCubit>().addItem(item);
// 注意：Cubit 暴露命名方法（addItem, removeItem）；
// .add(event) 是 BLoC 事件 API — 不要混淆使用。
```

```
$ flutter analyze
未发现问题！
```

## 最终验证

```
$ flutter test
所有测试通过。
```

## 总结

| 指标 | 数量 |
|--------|-------|
| 分析错误修复 | 2 |
| 修改的文件 | 2 |
| 剩余问题 | 0 |

构建状态：通过 ✓
````

## 常见错误修复

| 错误 | 典型修复 |
|-------|-------------|
| `A value of type 'X?' can't be assigned to 'X'` | 添加 `?? default` 或空值保护 |
| `The name 'X' isn't defined` | 添加导入或修正拼写错误 |
| `Non-nullable instance field must be initialized` | 添加初始化器或 `late` |
| `Version solving failed` | 调整 pubspec.yaml 中的版本约束 |
| `Missing concrete implementation of 'X'` | 实现缺失的接口方法 |
| `build_runner: Part of X expected` | 删除过时的 `.g.dart` 并重建 |

## 修复策略

1. **优先分析错误** — 代码必须无错误
2. **其次处理警告** — 修复可能导致运行时错误的警告
3. **第三解决 pub 冲突** — 修复依赖解析问题
4. **每次修复一个** — 验证每次更改
5. **最小改动** — 仅修复，不重构

## 停止条件

代理将在以下情况停止并报告：

* 同一错误在 3 次尝试后仍然存在
* 修复引入了更多错误
* 需要架构变更
* 包升级冲突需要用户决策

## 相关命令

* `/flutter-test` — 构建成功后运行测试
* `/flutter-review` — 审查代码质量
* `verification-loop` 技能 — 完整验证循环

## 相关信息

* 代理：`agents/dart-build-resolver.md`
* 技能：`skills/flutter-dart-code-review/`
