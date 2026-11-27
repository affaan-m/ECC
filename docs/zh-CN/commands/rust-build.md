---
description: 逐步修复 Rust 构建错误、借用检查器问题和依赖问题。调用 rust-build-resolver 代理以进行最小化、精确的修复。
---

# Rust 构建与修复

此命令调用 **rust-build-resolver** 代理，以最小改动逐步修复 Rust 构建错误。

## 此命令的作用

1. **运行诊断**：执行 `cargo check`、`cargo clippy`、`cargo fmt --check`
2. **解析错误**：识别错误代码和受影响的文件
3. **逐步修复**：一次修复一个错误
4. **验证每次修复**：每次更改后重新运行 `cargo check`
5. **报告摘要**：显示已修复的内容和剩余问题

## 使用时机

在以下情况下使用 `/rust-build`：

* `cargo build` 或 `cargo check` 因错误而失败时
* `cargo clippy` 报告警告时
* 借用检查器或生命周期错误阻碍编译时
* Cargo 依赖项解析失败时
* 拉取导致构建破坏的更改后

## 运行的诊断命令

```bash
# Primary build check
cargo check 2>&1

# Lints and suggestions
cargo clippy -- -D warnings 2>&1

# Formatting check
cargo fmt --check 2>&1

# Dependency issues
cargo tree --duplicates

# Security audit (if available)
if command -v cargo-audit >/dev/null; then cargo audit; else echo "cargo-audit not installed"; fi
```

## 示例会话

````text
User: /rust-build

Agent:
# Rust Build Resolution

## Initial Diagnostics

```bash
$ cargo check
error[E0502]: cannot borrow `map` as mutable because it is also borrowed as immutable
  --> src/service/cache.rs:25:5
error[E0308]: mismatched types
  --> src/handler/api.rs:42:12
error[E0425]: cannot find value `db` in this scope
  --> src/handler/api.rs:58:9
```

Errors found: 3

## Fix 1: Borrow Checker Error

File: src/service/cache.rs:25
Error: E0502 — cannot borrow `map` as mutable because also borrowed as immutable
Cause: Immutable borrow still active during mutable insert

```rust
// Changed: restructured to end immutable borrow before mutable access
if !map.contains_key("key") {
    map.insert("key".into(), default);
}
```

```bash
$ cargo check
# 2 errors remaining
```

## Fix 2: Type Mismatch

File: src/handler/api.rs:42
Error: E0308 — mismatched types: expected `usize`, found `&str`

```rust
// Changed
let count = params.get("count");
// To
let count: usize = params.get("count")
    .and_then(|s| s.parse().ok())
    .unwrap_or(0);
```

```bash
$ cargo check
# 1 error remaining
```

## Fix 3: Unresolved Name

File: src/handler/api.rs:58
Error: E0425 — cannot find value `db` in this scope
Cause: Missing import

```rust
// Added
use crate::db;
```

```bash
$ cargo check
# Build successful!
```

## Final Verification

```bash
$ cargo clippy -- -D warnings
# No warnings

$ cargo test
running 6 tests
test service::cache::tests::test_insert ... ok
test service::cache::tests::test_get ... ok
test handler::api::tests::test_parse_count ... ok
test handler::api::tests::test_missing_count ... ok
test handler::api::tests::test_db_import ... ok
test handler::api::tests::test_response ... ok

test result: ok. 6 passed; 0 failed; 0 ignored
```

## Summary

| Metric | Count |
|--------|-------|
| Build errors fixed | 3 |
| Clippy warnings fixed | 0 |
| Files modified | 2 |
| Remaining issues | 0 |

Build Status: SUCCESS
````

## 修复的常见错误

| 错误 | 典型修复方法 |
|-------|-------------|
| `cannot borrow as mutable` | 重构以先结束不可变借用；仅在合理情况下克隆 |
| `does not live long enough` | 使用拥有所有权的类型或添加生命周期注解 |
| `cannot move out of` | 重构以获取所有权；仅作为最后手段进行克隆 |
| `mismatched types` | 添加 `.into()`、`as` 或显式转换 |
| `trait X not implemented` | 添加 `#[derive(Trait)]` 或手动实现 |
| `unresolved import` | 添加到 Cargo.toml 或修复 `use` 路径 |
| `cannot find value` | 添加导入或修复路径 |

## 修复策略

1. **首先解决构建错误** - 代码必须能够编译
2. **其次解决 Clippy 警告** - 修复可疑的构造
3. **第三处理格式化** - 符合 `cargo fmt` 标准
4. **一次修复一个** - 验证每次更改
5. **最小化改动** - 不进行重构，仅修复问题

## 停止条件

代理将在以下情况下停止并报告：

* 同一错误尝试 3 次后仍然存在
* 修复引入了更多错误
* 需要架构性更改
* 借用检查器错误需要重新设计数据所有权

## 相关命令

* `/rust-test` - 构建成功后运行测试
* `/rust-review` - 审查代码质量
* `/verify` - 完整验证循环

## 相关

* 代理：`agents/rust-build-resolver.md`
* 技能：`skills/rust-patterns/`
