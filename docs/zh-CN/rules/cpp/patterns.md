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

# C++ 模式

> 本文档基于 [common/patterns.md](../common/patterns.md) 扩展了 C++ 特定内容。

## RAII（资源获取即初始化）

将资源生命周期与对象生命周期绑定：

```cpp
class FileHandle {
public:
    explicit FileHandle(const std::string& path) : file_(std::fopen(path.c_str(), "r")) {}
    ~FileHandle() { if (file_) std::fclose(file_); }
    FileHandle(const FileHandle&) = delete;
    FileHandle& operator=(const FileHandle&) = delete;
private:
    std::FILE* file_;
};
```

## 三五法则/零法则

* **零法则**：优先使用不需要自定义析构函数、拷贝/移动构造函数或赋值运算符的类。
* **五法则**：如果你定义了析构函数、拷贝构造函数、拷贝赋值运算符、移动构造函数或移动赋值运算符中的任何一个，那么就需要定义全部五个。

## 值语义

* 按值传递小型/平凡类型。
* 按 `const&` 传递大型类型。
* 按值返回（依赖 RVO/NRVO）。
* 对于接收后即被消耗的参数，使用移动语义。

## 错误处理

* 使用异常处理异常情况。
* 对于可能不存在的值，使用 `std::optional`。
* 对于预期的失败，使用 `std::expected`（C++23）或结果类型。

## 参考

有关全面的 C++ 模式和反模式，请参阅技能：`cpp-coding-standards`。
