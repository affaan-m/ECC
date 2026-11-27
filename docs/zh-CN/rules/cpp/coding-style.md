---
paths:
  - "**/*.cpp"
  - "**/*.hpp"
  - "**/*.cc"
  - "**/*.hh"
  - "**/*.cxx"
  - "**/*.h"
  - "**/CMakeLists.txt"
---

# C++ 编码风格

> 本文档基于 [common/coding-style.md](../common/coding-style.md) 扩展了 C++ 特定内容。

## 现代 C++ (C++17/20/23)

* 优先使用**现代 C++ 特性**而非 C 风格结构
* 当类型可从上下文推断时，使用 `auto`
* 使用 `constexpr` 定义编译时常量
* 使用结构化绑定：`auto [key, value] = map_entry;`

## 资源管理

* **处处使用 RAII** — 避免手动 `new`/`delete`
* 使用 `std::unique_ptr` 表示独占所有权
* 仅在确实需要共享所有权时使用 `std::shared_ptr`
* 使用 `std::make_unique` / `std::make_shared` 替代原始 `new`

## 命名约定

* 类型/类：`PascalCase`
* 函数/方法：`snake_case` 或 `camelCase`（遵循项目约定）
* 常量：`kPascalCase` 或 `UPPER_SNAKE_CASE`
* 命名空间：`lowercase`
* 成员变量：`snake_case_`（尾随下划线）或 `m_` 前缀

## 格式化

* 使用 **clang-format** — 避免风格争论
* 提交前运行 `clang-format -i <file>`

## 参考

有关全面的 C++ 编码标准和指南，请参阅技能：`cpp-coding-standards`。
