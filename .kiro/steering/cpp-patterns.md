---
inclusion: fileMatch
fileMatchPattern: "*.cpp,*.hpp,*.h,*.cc,*.cxx"
description: C++ coding standards, RAII, smart pointers, and modern C++ patterns.
---

# C++ Patterns

> This file extends the common patterns with C++ specific content.

## Modern C++ (C++17/20/23)

- Prefer modern C++ features over C-style constructs
- Use `auto` when the type is obvious from context
- Use `constexpr` for compile-time constants
- Use structured bindings: `auto [key, value] = map_entry;`

## RAII (Resource Acquisition Is Initialization)

Tie resource lifetime to object lifetime — no manual `new`/`delete`:

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

## Smart Pointers

- Use `std::unique_ptr` for exclusive ownership
- Use `std::shared_ptr` only when shared ownership is truly needed
- Use `std::make_unique` / `std::make_shared` over raw `new`

## Rule of Five/Zero

- **Rule of Zero**: Prefer classes that need no custom destructor, copy/move constructors, or assignments
- **Rule of Five**: If you define any of destructor/copy-ctor/copy-assign/move-ctor/move-assign, define all five

## Value Semantics & Error Handling

- Pass small/trivial types by value, large types by `const&`
- Return by value (rely on RVO/NRVO)
- Use `std::optional` for values that may not exist
- Use `std::expected` (C++23) or result types for expected failures

## Memory Safety

- Never use raw `new`/`delete` — use smart pointers
- Never use C-style arrays — use `std::array` or `std::vector`
- Use `std::string` over `char*`
- Use `.at()` for bounds-checked access when safety matters
- Never use `strcpy`, `strcat`, `sprintf`

## Formatting & Static Analysis

```bash
clang-format -i <file>
clang-tidy --checks='*' src/*.cpp
cppcheck --enable=all src/
```

## Testing

Use GoogleTest (gtest/gmock) with CMake/CTest:

```bash
cmake --build build && ctest --test-dir build --output-on-failure
```

Always run tests with sanitizers in CI:

```bash
cmake -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined" ..
```

## Naming Conventions

- Types/Classes: `PascalCase`
- Functions/Methods: `snake_case` or `camelCase` (follow project convention)
- Constants: `kPascalCase` or `UPPER_SNAKE_CASE`
- Namespaces: `lowercase`

## Reference

See agents: `cpp-reviewer`, `cpp-build-resolver` for C++ review and build error resolution.
See skill: `cpp-coding-standards` for comprehensive C++ guidelines.
