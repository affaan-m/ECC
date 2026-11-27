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

# C++ 安全

> 本文档扩展了 [common/security.md](../common/security.md)，增加了 C++ 特有的内容。

## 内存安全

* 绝不使用原始的 `new`/`delete` — 使用智能指针
* 绝不使用 C 风格数组 — 使用 `std::array` 或 `std::vector`
* 绝不使用 `malloc`/`free` — 使用 C++ 分配方式
* 除非绝对必要，避免使用 `reinterpret_cast`

## 缓冲区溢出

* 使用 `std::string` 而非 `char*`
* 当安全性重要时，使用 `.at()` 进行边界检查访问
* 绝不使用 `strcpy`、`strcat`、`sprintf` — 使用 `std::string` 或 `fmt::format`

## 未定义行为

* 始终初始化变量
* 避免有符号整数溢出
* 绝不解引用空指针或悬垂指针
* 在 CI 中使用消毒剂：
  ```bash
  cmake -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined" ..
  ```

## 静态分析

* 使用 **clang-tidy** 进行自动化检查：
  ```bash
  clang-tidy --checks='*' src/*.cpp
  ```
* 使用 **cppcheck** 进行额外分析：
  ```bash
  cppcheck --enable=all src/
  ```

## 参考

查看技能：`cpp-coding-standards` 以获取详细的安全指南。
