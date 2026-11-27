---
paths:
  - "**/*.rs"
---

# Rust 编码风格

> 本文档扩展了 [common/coding-style.md](../common/coding-style.md) 中关于 Rust 的特定内容。

## 格式化

* **rustfmt** 用于强制执行 — 提交前务必运行 `cargo fmt`
* **clippy** 用于代码检查 — `cargo clippy -- -D warnings`（将警告视为错误）
* 4 空格缩进（rustfmt 默认）
* 最大行宽：100 个字符（rustfmt 默认）

## 不可变性

Rust 变量默认是不可变的 — 请遵循此原则：

* 默认使用 `let`；仅在需要修改时才使用 `let mut`
* 优先返回新值，而非原地修改
* 当函数可能分配内存也可能不分配时，使用 `Cow<'_, T>`

```rust
use std::borrow::Cow;

// GOOD — immutable by default, new value returned
fn normalize(input: &str) -> Cow<'_, str> {
    if input.contains(' ') {
        Cow::Owned(input.replace(' ', "_"))
    } else {
        Cow::Borrowed(input)
    }
}

// BAD — unnecessary mutation
fn normalize_bad(input: &mut String) {
    *input = input.replace(' ', "_");
}
```

## 命名

遵循标准的 Rust 约定：

* `snake_case` 用于函数、方法、变量、模块、crate
* `PascalCase`（大驼峰式）用于类型、特征、枚举、类型参数
* `SCREAMING_SNAKE_CASE` 用于常量和静态变量
* 生命周期：简短的小写字母（`'a`，`'de`）— 复杂情况使用描述性名称（`'input`）

## 所有权与借用

* 默认借用（`&T`）；仅在需要存储或消耗时再获取所有权
* 切勿在不理解根本原因的情况下，为了满足借用检查器而克隆数据
* 在函数参数中，优先接受 `&str` 而非 `String`，优先接受 `&[T]` 而非 `Vec<T>`
* 对于需要拥有 `String` 的构造函数，使用 `impl Into<String>`

```rust
// GOOD — borrows when ownership isn't needed
fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

// GOOD — takes ownership in constructor via Into
fn new(name: impl Into<String>) -> Self {
    Self { name: name.into() }
}

// BAD — takes String when &str suffices
fn word_count_bad(text: String) -> usize {
    text.split_whitespace().count()
}
```

## 错误处理

* 使用 `Result<T, E>` 和 `?` 进行传播 — 切勿在生产代码中使用 `unwrap()`
* **库**：使用 `thiserror` 定义类型化错误
* **应用程序**：使用 `anyhow` 以获取灵活的错误上下文
* 使用 `.with_context(|| format!("failed to ..."))?` 添加上下文
* 将 `unwrap()` / `expect()` 保留用于测试和真正无法到达的状态

```rust
// GOOD — library error with thiserror
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("failed to read config: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid config format: {0}")]
    Parse(String),
}

// GOOD — application error with anyhow
use anyhow::Context;

fn load_config(path: &str) -> anyhow::Result<Config> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {path}"))?;
    toml::from_str(&content)
        .with_context(|| format!("failed to parse {path}"))
}
```

## 迭代器优于循环

对于转换操作，优先使用迭代器链；对于复杂的控制流，使用循环：

```rust
// GOOD — declarative and composable
let active_emails: Vec<&str> = users.iter()
    .filter(|u| u.is_active)
    .map(|u| u.email.as_str())
    .collect();

// GOOD — loop for complex logic with early returns
for user in &users {
    if let Some(verified) = verify_email(&user.email)? {
        send_welcome(&verified)?;
    }
}
```

## 模块组织

按领域而非类型组织：

```text
src/
├── main.rs
├── lib.rs
├── auth/           # 领域模块
│   ├── mod.rs
│   ├── token.rs
│   └── middleware.rs
├── orders/         # 领域模块
│   ├── mod.rs
│   ├── model.rs
│   └── service.rs
└── db/             # 基础设施
    ├── mod.rs
    └── pool.rs
```

## 可见性

* 默认为私有；使用 `pub(crate)` 进行内部共享
* 仅将属于 crate 公共 API 的部分标记为 `pub`
* 从 `lib.rs` 重新导出公共 API

## 参考

有关全面的 Rust 惯用法和模式，请参阅技能：`rust-patterns`。
