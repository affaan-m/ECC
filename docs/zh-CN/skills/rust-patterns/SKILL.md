---
name: rust-patterns
description: 地道的Rust模式、所有权、错误处理、特质、并发，以及构建安全、高性能应用程序的最佳实践。
origin: ECC
---

# Rust 开发模式

构建安全、高性能且可维护应用程序的惯用 Rust 模式和最佳实践。

## 何时使用

* 编写新的 Rust 代码时
* 评审 Rust 代码时
* 重构现有 Rust 代码时
* 设计 crate 结构和模块布局时

## 工作原理

此技能在六个关键领域强制执行惯用的 Rust 约定：所有权和借用，用于在编译时防止数据竞争；`Result`/`?` 错误传播，库使用 `thiserror` 而应用程序使用 `anyhow`；枚举和穷尽模式匹配，使非法状态无法表示；用于零成本抽象的 trait 和泛型；通过 `Arc<Mutex<T>>`、通道和 async/await 实现的安全并发；以及按领域组织的最小化 `pub` 接口。

## 核心原则

### 1. 所有权和借用

Rust 的所有权系统在编译时防止数据竞争和内存错误。

```rust
// Good: Pass references when you don't need ownership
fn process(data: &[u8]) -> usize {
    data.len()
}

// Good: Take ownership only when you need to store or consume
fn store(data: Vec<u8>) -> Record {
    Record { payload: data }
}

// Bad: Cloning unnecessarily to avoid borrow checker
fn process_bad(data: &Vec<u8>) -> usize {
    let cloned = data.clone(); // Wasteful — just borrow
    cloned.len()
}
```

### 使用 `Cow` 实现灵活的所有权

```rust
use std::borrow::Cow;

fn normalize(input: &str) -> Cow<'_, str> {
    if input.contains(' ') {
        Cow::Owned(input.replace(' ', "_"))
    } else {
        Cow::Borrowed(input) // Zero-cost when no mutation needed
    }
}
```

## 错误处理

### 使用 `Result` 和 `?` —— 切勿在生产环境中使用 `unwrap()`

```rust
// Good: Propagate errors with context
use anyhow::{Context, Result};

fn load_config(path: &str) -> Result<Config> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read config from {path}"))?;
    let config: Config = toml::from_str(&content)
        .with_context(|| format!("failed to parse config from {path}"))?;
    Ok(config)
}

// Bad: Panics on error
fn load_config_bad(path: &str) -> Config {
    let content = std::fs::read_to_string(path).unwrap(); // Panics!
    toml::from_str(&content).unwrap()
}
```

### 库错误使用 `thiserror`，应用程序错误使用 `anyhow`

```rust
// Library code: structured, typed errors
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("record not found: {id}")]
    NotFound { id: String },
    #[error("connection failed")]
    Connection(#[from] std::io::Error),
    #[error("invalid data: {0}")]
    InvalidData(String),
}

// Application code: flexible error handling
use anyhow::{bail, Result};

fn run() -> Result<()> {
    let config = load_config("app.toml")?;
    if config.workers == 0 {
        bail!("worker count must be > 0");
    }
    Ok(())
}
```

### 优先使用 `Option` 组合子而非嵌套匹配

```rust
// Good: Combinator chain
fn find_user_email(users: &[User], id: u64) -> Option<String> {
    users.iter()
        .find(|u| u.id == id)
        .map(|u| u.email.clone())
}

// Bad: Deeply nested matching
fn find_user_email_bad(users: &[User], id: u64) -> Option<String> {
    match users.iter().find(|u| u.id == id) {
        Some(user) => match &user.email {
            email => Some(email.clone()),
        },
        None => None,
    }
}
```

## 枚举和模式匹配

### 将状态建模为枚举

```rust
// Good: Impossible states are unrepresentable
enum ConnectionState {
    Disconnected,
    Connecting { attempt: u32 },
    Connected { session_id: String },
    Failed { reason: String, retries: u32 },
}

fn handle(state: &ConnectionState) {
    match state {
        ConnectionState::Disconnected => connect(),
        ConnectionState::Connecting { attempt } if *attempt > 3 => abort(),
        ConnectionState::Connecting { .. } => wait(),
        ConnectionState::Connected { session_id } => use_session(session_id),
        ConnectionState::Failed { retries, .. } if *retries < 5 => retry(),
        ConnectionState::Failed { reason, .. } => log_failure(reason),
    }
}
```

### 穷尽匹配 —— 业务逻辑中不使用通配符

```rust
// Good: Handle every variant explicitly
match command {
    Command::Start => start_service(),
    Command::Stop => stop_service(),
    Command::Restart => restart_service(),
    // Adding a new variant forces handling here
}

// Bad: Wildcard hides new variants
match command {
    Command::Start => start_service(),
    _ => {} // Silently ignores Stop, Restart, and future variants
}
```

## Trait 和泛型

### 接受泛型，返回具体类型

```rust
// Good: Generic input, concrete output
fn read_all(reader: &mut impl Read) -> std::io::Result<Vec<u8>> {
    let mut buf = Vec::new();
    reader.read_to_end(&mut buf)?;
    Ok(buf)
}

// Good: Trait bounds for multiple constraints
fn process<T: Display + Send + 'static>(item: T) -> String {
    format!("processed: {item}")
}
```

### 使用 Trait 对象进行动态分发

```rust
// Use when you need heterogeneous collections or plugin systems
trait Handler: Send + Sync {
    fn handle(&self, request: &Request) -> Response;
}

struct Router {
    handlers: Vec<Box<dyn Handler>>,
}

// Use generics when you need performance (monomorphization)
fn fast_process<H: Handler>(handler: &H, request: &Request) -> Response {
    handler.handle(request)
}
```

### 使用 Newtype 模式确保类型安全

```rust
// Good: Distinct types prevent mixing up arguments
struct UserId(u64);
struct OrderId(u64);

fn get_order(user: UserId, order: OrderId) -> Result<Order> {
    // Can't accidentally swap user and order IDs
    todo!()
}

// Bad: Easy to swap arguments
fn get_order_bad(user_id: u64, order_id: u64) -> Result<Order> {
    todo!()
}
```

## 结构体和数据建模

### 使用构建器模式进行复杂构造

```rust
struct ServerConfig {
    host: String,
    port: u16,
    max_connections: usize,
}

impl ServerConfig {
    fn builder(host: impl Into<String>, port: u16) -> ServerConfigBuilder {
        ServerConfigBuilder { host: host.into(), port, max_connections: 100 }
    }
}

struct ServerConfigBuilder { host: String, port: u16, max_connections: usize }

impl ServerConfigBuilder {
    fn max_connections(mut self, n: usize) -> Self { self.max_connections = n; self }
    fn build(self) -> ServerConfig {
        ServerConfig { host: self.host, port: self.port, max_connections: self.max_connections }
    }
}

// Usage: ServerConfig::builder("localhost", 8080).max_connections(200).build()
```

## 迭代器和闭包

### 优先使用迭代器链而非手动循环

```rust
// Good: Declarative, lazy, composable
let active_emails: Vec<String> = users.iter()
    .filter(|u| u.is_active)
    .map(|u| u.email.clone())
    .collect();

// Bad: Imperative accumulation
let mut active_emails = Vec::new();
for user in &users {
    if user.is_active {
        active_emails.push(user.email.clone());
    }
}
```

### 使用带有类型注解的 `collect()`

```rust
// Collect into different types
let names: Vec<_> = items.iter().map(|i| &i.name).collect();
let lookup: HashMap<_, _> = items.iter().map(|i| (i.id, i)).collect();
let combined: String = parts.iter().copied().collect();

// Collect Results — short-circuits on first error
let parsed: Result<Vec<i32>, _> = strings.iter().map(|s| s.parse()).collect();
```

## 并发

### 使用 `Arc<Mutex<T>>` 处理共享可变状态

```rust
use std::sync::{Arc, Mutex};

let counter = Arc::new(Mutex::new(0));
let handles: Vec<_> = (0..10).map(|_| {
    let counter = Arc::clone(&counter);
    std::thread::spawn(move || {
        let mut num = counter.lock().expect("mutex poisoned");
        *num += 1;
    })
}).collect();

for handle in handles {
    handle.join().expect("worker thread panicked");
}
```

### 使用通道进行消息传递

```rust
use std::sync::mpsc;

let (tx, rx) = mpsc::sync_channel(16); // Bounded channel with backpressure

for i in 0..5 {
    let tx = tx.clone();
    std::thread::spawn(move || {
        tx.send(format!("message {i}")).expect("receiver disconnected");
    });
}
drop(tx); // Close sender so rx iterator terminates

for msg in rx {
    println!("{msg}");
}
```

### 使用 Tokio 进行异步编程

```rust
use tokio::time::Duration;

async fn fetch_with_timeout(url: &str) -> Result<String> {
    let response = tokio::time::timeout(
        Duration::from_secs(5),
        reqwest::get(url),
    )
    .await
    .context("request timed out")?
    .context("request failed")?;

    response.text().await.context("failed to read body")
}

// Spawn concurrent tasks
async fn fetch_all(urls: Vec<String>) -> Vec<Result<String>> {
    let handles: Vec<_> = urls.into_iter()
        .map(|url| tokio::spawn(async move {
            fetch_with_timeout(&url).await
        }))
        .collect();

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        results.push(handle.await.unwrap_or_else(|e| panic!("spawned task panicked: {e}")));
    }
    results
}
```

## 不安全代码

### 何时可以使用 Unsafe

```rust
// Acceptable: FFI boundary with documented invariants (Rust 2024+)
/// # Safety
/// `ptr` must be a valid, aligned pointer to an initialized `Widget`.
unsafe fn widget_from_raw<'a>(ptr: *const Widget) -> &'a Widget {
    // SAFETY: caller guarantees ptr is valid and aligned
    unsafe { &*ptr }
}

// Acceptable: Performance-critical path with proof of correctness
// SAFETY: index is always < len due to the loop bound
unsafe { slice.get_unchecked(index) }
```

### 何时不可以使用 Unsafe

```rust
// Bad: Using unsafe to bypass borrow checker
// Bad: Using unsafe for convenience
// Bad: Using unsafe without a Safety comment
// Bad: Transmuting between unrelated types
```

## 模块系统和 Crate 结构

### 按领域组织，而非按类型

```text
my_app/
├── src/
│   ├── main.rs
│   ├── lib.rs
│   ├── auth/          # 领域模块
│   │   ├── mod.rs
│   │   ├── token.rs
│   │   └── middleware.rs
│   ├── orders/        # 领域模块
│   │   ├── mod.rs
│   │   ├── model.rs
│   │   └── service.rs
│   └── db/            # 基础设施
│       ├── mod.rs
│       └── pool.rs
├── tests/             # 集成测试
├── benches/           # 基准测试
└── Cargo.toml
```

### 可见性 —— 最小化暴露

```rust
// Good: pub(crate) for internal sharing
pub(crate) fn validate_input(input: &str) -> bool {
    !input.is_empty()
}

// Good: Re-export public API from lib.rs
pub mod auth;
pub use auth::AuthMiddleware;

// Bad: Making everything pub
pub fn internal_helper() {} // Should be pub(crate) or private
```

## 工具集成

### 基本命令

```bash
# Build and check
cargo build
cargo check              # Fast type checking without codegen
cargo clippy             # Lints and suggestions
cargo fmt                # Format code

# Testing
cargo test
cargo test -- --nocapture    # Show println output
cargo test --lib             # Unit tests only
cargo test --test integration # Integration tests only

# Dependencies
cargo audit              # Security audit
cargo tree               # Dependency tree
cargo update             # Update dependencies

# Performance
cargo bench              # Run benchmarks
```

## 快速参考：Rust 惯用法

| 惯用法 | 描述 |
|-------|-------------|
| 借用，而非克隆 | 传递 `&T`，除非需要所有权，否则不要克隆 |
| 使非法状态无法表示 | 使用枚举仅对有效状态进行建模 |
| `?` 优于 `unwrap()` | 传播错误，切勿在库/生产代码中恐慌 |
| 解析，而非验证 | 在边界处将非结构化数据转换为类型化结构体 |
| Newtype 用于类型安全 | 将基本类型包装在 newtype 中以防止参数错位 |
| 优先使用迭代器而非循环 | 声明式链更清晰且通常更快 |
| 对 Result 使用 `#[must_use]` | 确保调用者处理返回值 |
| 使用 `Cow` 实现灵活的所有权 | 当借用足够时避免分配 |
| 穷尽匹配 | 业务关键枚举不使用通配符 `_` |
| 最小化 `pub` 接口 | 内部 API 使用 `pub(crate)` |

## 应避免的反模式

```rust
// Bad: .unwrap() in production code
let value = map.get("key").unwrap();

// Bad: .clone() to satisfy borrow checker without understanding why
let data = expensive_data.clone();
process(&original, &data);

// Bad: Using String when &str suffices
fn greet(name: String) { /* should be &str */ }

// Bad: Box<dyn Error> in libraries (use thiserror instead)
fn parse(input: &str) -> Result<Data, Box<dyn std::error::Error>> { todo!() }

// Bad: Ignoring must_use warnings
let _ = validate(input); // Silently discarding a Result

// Bad: Blocking in async context
async fn bad_async() {
    std::thread::sleep(Duration::from_secs(1)); // Blocks the executor!
    // Use: tokio::time::sleep(Duration::from_secs(1)).await;
}
```

**请记住**：如果它能编译，那它很可能是正确的 —— 但前提是你要避免 `unwrap()`，最小化 `unsafe`，并让类型系统为你工作。
