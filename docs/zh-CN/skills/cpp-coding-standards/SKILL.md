---
name: cpp-coding-standards
description: 基于C++核心指南（isocpp.github.io）的C++编码标准。在编写、审查或重构C++代码时使用，以强制实施现代、安全和惯用的实践。
origin: ECC
---

# C++ 编码标准（C++ 核心准则）

源自 [C++ 核心准则](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines) 的现代 C++（C++17/20/23）综合编码标准。强制执行类型安全、资源安全、不变性和清晰性。

## 何时使用

* 编写新的 C++ 代码（类、函数、模板）
* 审查或重构现有的 C++ 代码
* 在 C++ 项目中做出架构决策
* 在 C++ 代码库中强制执行一致的风格
* 在语言特性之间做出选择（例如，`enum` 对比 `enum class`，原始指针对比智能指针）

### 何时不应使用

* 非 C++ 项目
* 无法采用现代 C++ 特性的遗留 C 代码库
* 特定准则与硬件限制冲突的嵌入式/裸机环境（选择性适配）

## 贯穿性原则

这些主题在整个准则中反复出现，并构成了基础：

1. **处处使用 RAII** (P.8, R.1, E.6, CP.20)：将资源生命周期绑定到对象生命周期
2. **默认为不可变性** (P.10, Con.1-5, ES.25)：从 `const`/`constexpr` 开始；可变性是例外
3. **类型安全** (P.4, I.4, ES.46-49, Enum.3)：使用类型系统在编译时防止错误
4. **表达意图** (P.3, F.1, NL.1-2, T.10)：名称、类型和概念应传达目的
5. **最小化复杂性** (F.2-3, ES.5, Per.4-5)：简单的代码就是正确的代码
6. **值语义优于指针语义** (C.10, R.3-5, F.20, CP.31)：优先按值返回和作用域对象

## 哲学与接口 (P.\*, I.\*)

### 关键规则

| 规则 | 摘要 |
|------|---------|
| **P.1** | 直接在代码中表达想法 |
| **P.3** | 表达意图 |
| **P.4** | 理想情况下，程序应是静态类型安全的 |
| **P.5** | 优先编译时检查而非运行时检查 |
| **P.8** | 不要泄漏任何资源 |
| **P.10** | 优先不可变数据而非可变数据 |
| **I.1** | 使接口明确 |
| **I.2** | 避免非 const 全局变量 |
| **I.4** | 使接口精确且强类型化 |
| **I.11** | 切勿通过原始指针或引用转移所有权 |
| **I.23** | 保持函数参数数量少 |

### 应该做

```cpp
// P.10 + I.4: Immutable, strongly typed interface
struct Temperature {
    double kelvin;
};

Temperature boil(const Temperature& water);
```

### 不应该做

```cpp
// Weak interface: unclear ownership, unclear units
double boil(double* temp);

// Non-const global variable
int g_counter = 0;  // I.2 violation
```

## 函数 (F.\*)

### 关键规则

| 规则 | 摘要 |
|------|---------|
| **F.1** | 将有意义的操作打包为精心命名的函数 |
| **F.2** | 函数应执行单一逻辑操作 |
| **F.3** | 保持函数简短简单 |
| **F.4** | 如果函数可能在编译时求值，则将其声明为 `constexpr` |
| **F.6** | 如果你的函数绝不能抛出异常，则将其声明为 `noexcept` |
| **F.8** | 优先纯函数 |
| **F.16** | 对于 "输入" 参数，按值传递廉价可复制类型，其他类型通过 `const&` 传递 |
| **F.20** | 对于 "输出" 值，优先返回值而非输出参数 |
| **F.21** | 要返回多个 "输出" 值，优先返回结构体 |
| **F.43** | 切勿返回指向局部对象的指针或引用 |

### 参数传递

```cpp
// F.16: Cheap types by value, others by const&
void print(int x);                           // cheap: by value
void analyze(const std::string& data);       // expensive: by const&
void transform(std::string s);               // sink: by value (will move)

// F.20 + F.21: Return values, not output parameters
struct ParseResult {
    std::string token;
    int position;
};

ParseResult parse(std::string_view input);   // GOOD: return struct

// BAD: output parameters
void parse(std::string_view input,
           std::string& token, int& pos);    // avoid this
```

### 纯函数和 constexpr

```cpp
// F.4 + F.8: Pure, constexpr where possible
constexpr int factorial(int n) noexcept {
    return (n <= 1) ? 1 : n * factorial(n - 1);
}

static_assert(factorial(5) == 120);
```

### 反模式

* 从函数返回 `T&&` (F.45)
* 使用 `va_arg` / C 风格可变参数 (F.55)
* 在传递给其他线程的 lambda 中通过引用捕获 (F.53)
* 返回 `const T`，这会抑制移动语义 (F.49)

## 类与类层次结构 (C.\*)

### 关键规则

| 规则 | 摘要 |
|------|---------|
| **C.2** | 如果存在不变式，使用 `class`；如果数据成员独立变化，使用 `struct` |
| **C.9** | 最小化成员的暴露 |
| **C.20** | 如果你能避免定义默认操作，就这么做（零规则） |
| **C.21** | 如果你定义或 `=delete` 任何拷贝/移动/析构函数，则处理所有（五规则） |
| **C.35** | 基类析构函数：公开虚函数或受保护非虚函数 |
| **C.41** | 构造函数应创建完全初始化的对象 |
| **C.46** | 将单参数构造函数声明为 `explicit` |
| **C.67** | 多态类应禁止公开拷贝/移动 |
| **C.128** | 虚函数：精确指定 `virtual`、`override` 或 `final` 中的一个 |

### 零规则

```cpp
// C.20: Let the compiler generate special members
struct Employee {
    std::string name;
    std::string department;
    int id;
    // No destructor, copy/move constructors, or assignment operators needed
};
```

### 五规则

```cpp
// C.21: If you must manage a resource, define all five
class Buffer {
public:
    explicit Buffer(std::size_t size)
        : data_(std::make_unique<char[]>(size)), size_(size) {}

    ~Buffer() = default;

    Buffer(const Buffer& other)
        : data_(std::make_unique<char[]>(other.size_)), size_(other.size_) {
        std::copy_n(other.data_.get(), size_, data_.get());
    }

    Buffer& operator=(const Buffer& other) {
        if (this != &other) {
            auto new_data = std::make_unique<char[]>(other.size_);
            std::copy_n(other.data_.get(), other.size_, new_data.get());
            data_ = std::move(new_data);
            size_ = other.size_;
        }
        return *this;
    }

    Buffer(Buffer&&) noexcept = default;
    Buffer& operator=(Buffer&&) noexcept = default;

private:
    std::unique_ptr<char[]> data_;
    std::size_t size_;
};
```

### 类层次结构

```cpp
// C.35 + C.128: Virtual destructor, use override
class Shape {
public:
    virtual ~Shape() = default;
    virtual double area() const = 0;  // C.121: pure interface
};

class Circle : public Shape {
public:
    explicit Circle(double r) : radius_(r) {}
    double area() const override { return 3.14159 * radius_ * radius_; }

private:
    double radius_;
};
```

### 反模式

* 在构造函数/析构函数中调用虚函数 (C.82)
* 在非平凡类型上使用 `memset`/`memcpy` (C.90)
* 为虚函数和重写函数提供不同的默认参数 (C.140)
* 将数据成员设为 `const` 或引用，这会抑制移动/拷贝 (C.12)

## 资源管理 (R.\*)

### 关键规则

| 规则 | 摘要 |
|------|---------|
| **R.1** | 使用 RAII 自动管理资源 |
| **R.3** | 原始指针 (`T*`) 是非拥有的 |
| **R.5** | 优先作用域对象；不要不必要地在堆上分配 |
| **R.10** | 避免 `malloc()`/`free()` |
| **R.11** | 避免显式调用 `new` 和 `delete` |
| **R.20** | 使用 `unique_ptr` 或 `shared_ptr` 表示所有权 |
| **R.21** | 除非共享所有权，否则优先 `unique_ptr` 而非 `shared_ptr` |
| **R.22** | 使用 `make_shared()` 来创建 `shared_ptr` |

### 智能指针使用

```cpp
// R.11 + R.20 + R.21: RAII with smart pointers
auto widget = std::make_unique<Widget>("config");  // unique ownership
auto cache  = std::make_shared<Cache>(1024);        // shared ownership

// R.3: Raw pointer = non-owning observer
void render(const Widget* w) {  // does NOT own w
    if (w) w->draw();
}

render(widget.get());
```

### RAII 模式

```cpp
// R.1: Resource acquisition is initialization
class FileHandle {
public:
    explicit FileHandle(const std::string& path)
        : handle_(std::fopen(path.c_str(), "r")) {
        if (!handle_) throw std::runtime_error("Failed to open: " + path);
    }

    ~FileHandle() {
        if (handle_) std::fclose(handle_);
    }

    FileHandle(const FileHandle&) = delete;
    FileHandle& operator=(const FileHandle&) = delete;
    FileHandle(FileHandle&& other) noexcept
        : handle_(std::exchange(other.handle_, nullptr)) {}
    FileHandle& operator=(FileHandle&& other) noexcept {
        if (this != &other) {
            if (handle_) std::fclose(handle_);
            handle_ = std::exchange(other.handle_, nullptr);
        }
        return *this;
    }

private:
    std::FILE* handle_;
};
```

### 反模式

* 裸 `new`/`delete` (R.11)
* C++ 代码中的 `malloc()`/`free()` (R.10)
* 在单个表达式中进行多次资源分配 (R.13 -- 异常安全风险)
* 在 `unique_ptr` 足够时使用 `shared_ptr` (R.21)

## 表达式与语句 (ES.\*)

### 关键规则

| 规则 | 摘要 |
|------|---------|
| **ES.5** | 保持作用域小 |
| **ES.20** | 始终初始化对象 |
| **ES.23** | 优先 `{}` 初始化语法 |
| **ES.25** | 除非打算修改，否则将对象声明为 `const` 或 `constexpr` |
| **ES.28** | 使用 lambda 进行 `const` 变量的复杂初始化 |
| **ES.45** | 避免魔法常量；使用符号常量 |
| **ES.46** | 避免有损的算术转换 |
| **ES.47** | 使用 `nullptr` 而非 `0` 或 `NULL` |
| **ES.48** | 避免强制类型转换 |
| **ES.50** | 不要丢弃 `const` |

### 初始化

```cpp
// ES.20 + ES.23 + ES.25: Always initialize, prefer {}, default to const
const int max_retries{3};
const std::string name{"widget"};
const std::vector<int> primes{2, 3, 5, 7, 11};

// ES.28: Lambda for complex const initialization
const auto config = [&] {
    Config c;
    c.timeout = std::chrono::seconds{30};
    c.retries = max_retries;
    c.verbose = debug_mode;
    return c;
}();
```

### 反模式

* 未初始化的变量 (ES.20)
* 使用 `0` 或 `NULL` 作为指针 (ES.47 -- 使用 `nullptr`)
* C 风格强制类型转换 (ES.48 -- 使用 `static_cast`、`const_cast` 等)
* 丢弃 `const` (ES.50)
* 没有命名常量的魔法数字 (ES.45)
* 混合有符号和无符号算术 (ES.100)
* 在嵌套作用域中重用名称 (ES.12)

## 错误处理 (E.\*)

### 关键规则

| 规则 | 摘要 |
|------|---------|
| **E.1** | 在设计早期制定错误处理策略 |
| **E.2** | 抛出异常以表示函数无法执行其分配的任务 |
| **E.6** | 使用 RAII 防止泄漏 |
| **E.12** | 当抛出异常不可能或不可接受时，使用 `noexcept` |
| **E.14** | 使用专门设计的用户定义类型作为异常 |
| **E.15** | 按值抛出，按引用捕获 |
| **E.16** | 析构函数、释放和 swap 绝不能失败 |
| **E.17** | 不要试图在每个函数中捕获每个异常 |

### 异常层次结构

```cpp
// E.14 + E.15: Custom exception types, throw by value, catch by reference
class AppError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

class NetworkError : public AppError {
public:
    NetworkError(const std::string& msg, int code)
        : AppError(msg), status_code(code) {}
    int status_code;
};

void fetch_data(const std::string& url) {
    // E.2: Throw to signal failure
    throw NetworkError("connection refused", 503);
}

void run() {
    try {
        fetch_data("https://api.example.com");
    } catch (const NetworkError& e) {
        log_error(e.what(), e.status_code);
    } catch (const AppError& e) {
        log_error(e.what());
    }
    // E.17: Don't catch everything here -- let unexpected errors propagate
}
```

### 反模式

* 抛出内置类型，如 `int` 或字符串字面量 (E.14)
* 按值捕获（有切片风险） (E.15)
* 静默吞掉错误的空 catch 块
* 使用异常进行流程控制 (E.3)
* 基于全局状态（如 `errno`）的错误处理 (E.28)

## 常量与不可变性 (Con.\*)

### 所有规则

| 规则 | 摘要 |
|------|---------|
| **Con.1** | 默认情况下，使对象不可变 |
| **Con.2** | 默认情况下，使成员函数为 `const` |
| **Con.3** | 默认情况下，传递指向 `const` 的指针和引用 |
| **Con.4** | 对构造后不改变的值使用 `const` |
| **Con.5** | 对可在编译时计算的值使用 `constexpr` |

```cpp
// Con.1 through Con.5: Immutability by default
class Sensor {
public:
    explicit Sensor(std::string id) : id_(std::move(id)) {}

    // Con.2: const member functions by default
    const std::string& id() const { return id_; }
    double last_reading() const { return reading_; }

    // Only non-const when mutation is required
    void record(double value) { reading_ = value; }

private:
    const std::string id_;  // Con.4: never changes after construction
    double reading_{0.0};
};

// Con.3: Pass by const reference
void display(const Sensor& s) {
    std::cout << s.id() << ": " << s.last_reading() << '\n';
}

// Con.5: Compile-time constants
constexpr double PI = 3.14159265358979;
constexpr int MAX_SENSORS = 256;
```

## 并发与并行 (CP.\*)

### 关键规则

| 规则 | 摘要 |
|------|---------|
| **CP.2** | 避免数据竞争 |
| **CP.3** | 最小化可写数据的显式共享 |
| **CP.4** | 从任务的角度思考，而非线程 |
| **CP.8** | 不要使用 `volatile` 进行同步 |
| **CP.20** | 使用 RAII，切勿使用普通的 `lock()`/`unlock()` |
| **CP.21** | 使用 `std::scoped_lock` 来获取多个互斥量 |
| **CP.22** | 持有锁时切勿调用未知代码 |
| **CP.42** | 不要在没有条件的情况下等待 |
| **CP.44** | 记得为你的 `lock_guard` 和 `unique_lock` 命名 |
| **CP.100** | 除非绝对必要，否则不要使用无锁编程 |

### 安全加锁

```cpp
// CP.20 + CP.44: RAII locks, always named
class ThreadSafeQueue {
public:
    void push(int value) {
        std::lock_guard<std::mutex> lock(mutex_);  // CP.44: named!
        queue_.push(value);
        cv_.notify_one();
    }

    int pop() {
        std::unique_lock<std::mutex> lock(mutex_);
        // CP.42: Always wait with a condition
        cv_.wait(lock, [this] { return !queue_.empty(); });
        const int value = queue_.front();
        queue_.pop();
        return value;
    }

private:
    std::mutex mutex_;             // CP.50: mutex with its data
    std::condition_variable cv_;
    std::queue<int> queue_;
};
```

### 多个互斥量

```cpp
// CP.21: std::scoped_lock for multiple mutexes (deadlock-free)
void transfer(Account& from, Account& to, double amount) {
    std::scoped_lock lock(from.mutex_, to.mutex_);
    from.balance_ -= amount;
    to.balance_ += amount;
}
```

### 反模式

* 使用 `volatile` 进行同步 (CP.8 -- 它仅用于硬件 I/O)
* 分离线程 (CP.26 -- 生命周期管理变得几乎不可能)
* 未命名的锁保护：`std::lock_guard<std::mutex>(m);` 会立即销毁 (CP.44)
* 调用回调时持有锁 (CP.22 -- 死锁风险)
* 没有深厚专业知识就进行无锁编程 (CP.100)

## 模板与泛型编程 (T.\*)

### 关键规则

| 规则 | 摘要 |
|------|---------|
| **T.1** | 使用模板来提高抽象级别 |
| **T.2** | 使用模板为多种参数类型表达算法 |
| **T.10** | 为所有模板参数指定概念 |
| **T.11** | 尽可能使用标准概念 |
| **T.13** | 对于简单概念，优先使用简写符号 |
| **T.43** | 优先 `using` 而非 `typedef` |
| **T.120** | 仅在确实需要时使用模板元编程 |
| **T.144** | 不要特化函数模板（改用重载） |

### 概念 (C++20)

```cpp
#include <concepts>

// T.10 + T.11: Constrain templates with standard concepts
template<std::integral T>
T gcd(T a, T b) {
    while (b != 0) {
        a = std::exchange(b, a % b);
    }
    return a;
}

// T.13: Shorthand concept syntax
void sort(std::ranges::random_access_range auto& range) {
    std::ranges::sort(range);
}

// Custom concept for domain-specific constraints
template<typename T>
concept Serializable = requires(const T& t) {
    { t.serialize() } -> std::convertible_to<std::string>;
};

template<Serializable T>
void save(const T& obj, const std::string& path);
```

### 反模式

* 在可见命名空间中使用无约束模板 (T.47)
* 特化函数模板而非重载 (T.144)
* 在 `constexpr` 足够时使用模板元编程 (T.120)
* 使用 `typedef` 而非 `using` (T.43)

## 标准库 (SL.\*)

### 关键规则

| 规则 | 摘要 |
|------|---------|
| **SL.1** | 尽可能使用库 |
| **SL.2** | 优先标准库而非其他库 |
| **SL.con.1** | 优先 `std::array` 或 `std::vector` 而非 C 数组 |
| **SL.con.2** | 默认情况下优先 `std::vector` |
| **SL.str.1** | 使用 `std::string` 来拥有字符序列 |
| **SL.str.2** | 使用 `std::string_view` 来引用字符序列 |
| **SL.io.50** | 避免 `endl`（使用 `'\n'` -- `endl` 会强制刷新） |

```cpp
// SL.con.1 + SL.con.2: Prefer vector/array over C arrays
const std::array<int, 4> fixed_data{1, 2, 3, 4};
std::vector<std::string> dynamic_data;

// SL.str.1 + SL.str.2: string owns, string_view observes
std::string build_greeting(std::string_view name) {
    return "Hello, " + std::string(name) + "!";
}

// SL.io.50: Use '\n' not endl
std::cout << "result: " << value << '\n';
```

## 枚举 (Enum.\*)

### 关键规则

| 规则 | 摘要 |
|------|---------|
| **Enum.1** | 优先枚举而非宏 |
| **Enum.3** | 优先 `enum class` 而非普通 `enum` |
| **Enum.5** | 不要对枚举项使用全大写 |
| **Enum.6** | 避免未命名的枚举 |

```cpp
// Enum.3 + Enum.5: Scoped enum, no ALL_CAPS
enum class Color { red, green, blue };
enum class LogLevel { debug, info, warning, error };

// BAD: plain enum leaks names, ALL_CAPS clashes with macros
enum { RED, GREEN, BLUE };           // Enum.3 + Enum.5 + Enum.6 violation
#define MAX_SIZE 100                  // Enum.1 violation -- use constexpr
```

## 源文件与命名 (SF.*, NL.*)

### 关键规则

| 规则 | 摘要 |
|------|---------|
| **SF.1** | 代码文件使用 `.cpp`，接口文件使用 `.h` |
| **SF.7** | 不要在头文件的全局作用域内写 `using namespace` |
| **SF.8** | 所有 `.h` 文件都应使用 `#include` 防护 |
| **SF.11** | 头文件应是自包含的 |
| **NL.5** | 避免在名称中编码类型信息（不要使用匈牙利命名法） |
| **NL.8** | 使用一致的命名风格 |
| **NL.9** | 仅宏名使用 ALL\_CAPS |
| **NL.10** | 优先使用 `underscore_style` 命名 |

### 头文件防护

```cpp
// SF.8: Include guard (or #pragma once)
#ifndef PROJECT_MODULE_WIDGET_H
#define PROJECT_MODULE_WIDGET_H

// SF.11: Self-contained -- include everything this header needs
#include <string>
#include <vector>

namespace project::module {

class Widget {
public:
    explicit Widget(std::string name);
    const std::string& name() const;

private:
    std::string name_;
};

}  // namespace project::module

#endif  // PROJECT_MODULE_WIDGET_H
```

### 命名约定

```cpp
// NL.8 + NL.10: Consistent underscore_style
namespace my_project {

constexpr int max_buffer_size = 4096;  // NL.9: not ALL_CAPS (it's not a macro)

class tcp_connection {                 // underscore_style class
public:
    void send_message(std::string_view msg);
    bool is_connected() const;

private:
    std::string host_;                 // trailing underscore for members
    int port_;
};

}  // namespace my_project
```

### 反模式

* 在头文件的全局作用域内使用 `using namespace std;` (SF.7)
* 依赖包含顺序的头文件 (SF.10, SF.11)
* 匈牙利命名法，如 `strName`、`iCount` (NL.5)
* 宏以外的事物使用 ALL\_CAPS (NL.9)

## 性能 (Per.\*)

### 关键规则

| 规则 | 摘要 |
|------|---------|
| **Per.1** | 不要无故优化 |
| **Per.2** | 不要过早优化 |
| **Per.6** | 没有测量数据，不要断言性能 |
| **Per.7** | 设计时应考虑便于优化 |
| **Per.10** | 依赖静态类型系统 |
| **Per.11** | 将计算从运行时移至编译时 |
| **Per.19** | 以可预测的方式访问内存 |

### 指导原则

```cpp
// Per.11: Compile-time computation where possible
constexpr auto lookup_table = [] {
    std::array<int, 256> table{};
    for (int i = 0; i < 256; ++i) {
        table[i] = i * i;
    }
    return table;
}();

// Per.19: Prefer contiguous data for cache-friendliness
std::vector<Point> points;           // GOOD: contiguous
std::vector<std::unique_ptr<Point>> indirect_points; // BAD: pointer chasing
```

### 反模式

* 在没有性能分析数据的情况下进行优化 (Per.1, Per.6)
* 选择“巧妙”的低级代码而非清晰的抽象 (Per.4, Per.5)
* 忽略数据布局和缓存行为 (Per.19)

## 快速参考检查清单

在标记 C++ 工作完成之前：

* \[ ] 没有裸 `new`/`delete` —— 使用智能指针或 RAII (R.11)
* \[ ] 对象在声明时初始化 (ES.20)
* \[ ] 变量默认是 `const`/`constexpr` (Con.1, ES.25)
* \[ ] 成员函数尽可能设为 `const` (Con.2)
* \[ ] 使用 `enum class` 而非普通 `enum` (Enum.3)
* \[ ] 使用 `nullptr` 而非 `0`/`NULL` (ES.47)
* \[ ] 没有窄化转换 (ES.46)
* \[ ] 没有 C 风格转换 (ES.48)
* \[ ] 单参数构造函数是 `explicit` (C.46)
* \[ ] 应用了零法则或五法则 (C.20, C.21)
* \[ ] 基类析构函数是 public virtual 或 protected non-virtual (C.35)
* \[ ] 模板使用概念进行约束 (T.10)
* \[ ] 头文件全局作用域内没有 `using namespace` (SF.7)
* \[ ] 头文件有包含防护且是自包含的 (SF.8, SF.11)
* \[ ] 锁使用 RAII (`scoped_lock`/`lock_guard`) (CP.20)
* \[ ] 异常是自定义类型，按值抛出，按引用捕获 (E.14, E.15)
* \[ ] 使用 `'\n'` 而非 `std::endl` (SL.io.50)
* \[ ] 没有魔数 (ES.45)
