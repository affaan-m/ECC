---
description: 全面的Rust代码审查，涵盖所有权、生命周期、错误处理、不安全代码使用以及惯用模式。调用rust-reviewer代理。
---

# Rust 代码审查

此命令调用 **rust-reviewer** 代理进行全面的 Rust 专项代码审查。

## 此命令的作用

1. **验证自动化检查**：运行 `cargo check`、`cargo clippy -- -D warnings`、`cargo fmt --check` 和 `cargo test` —— 任何一项失败则停止
2. **识别 Rust 变更**：通过 `git diff HEAD~1`（或针对 PR 使用 `git diff main...HEAD`）查找修改过的 `.rs` 文件
3. **运行安全审计**：如果可用，则执行 `cargo audit`
4. **安全扫描**：检查不安全使用、命令注入、硬编码密钥
5. **所有权审查**：分析不必要的克隆、生命周期问题、借用模式
6. **生成报告**：按严重性对问题进行分类

## 何时使用

在以下情况下使用 `/rust-review`：

* 编写或修改 Rust 代码之后
* 提交 Rust 变更之前
* 审查包含 Rust 代码的拉取请求时
* 接手新的 Rust 代码库时
* 学习惯用的 Rust 模式时

## 审查类别

### 关键（必须修复）

* 生产代码路径中未经检查的 `unwrap()`/`expect()`
* 没有 `// SAFETY:` 注释记录不变量的 `unsafe`
* 查询中通过字符串插值导致的 SQL 注入
* 在 `std::process::Command` 中通过未经验证的输入导致的命令注入
* 硬编码凭据
* 通过原始指针导致的释放后使用

### 高（应该修复）

* 为满足借用检查器而进行的不必要的 `.clone()`
* 参数为 `String`，而 `&str` 或 `impl AsRef<str>` 即可满足
* 在异步上下文中的阻塞操作（`std::thread::sleep`、`std::fs`）
* 共享类型上缺少 `Send`/`Sync` 约束
* 对业务关键枚举使用通配符 `_ =>` 匹配
* 大型函数（>50 行）

### 中（考虑）

* 在热点路径中不必要的分配
* 已知大小时缺少 `with_capacity`
* 未说明理由就抑制 clippy 警告
* 公共 API 缺少 `///` 文档
* 对于忽略返回值很可能是错误的非 `must_use` 返回类型，考虑使用 `#[must_use]`

## 运行的自动化检查

```bash
# Build gate (must pass before review)
cargo check

# Lints and suggestions
cargo clippy -- -D warnings

# Formatting
cargo fmt --check

# Tests
cargo test

# Security audit (if available)
if command -v cargo-audit >/dev/null; then cargo audit; else echo "cargo-audit not installed"; fi
```

## 使用示例

````text
User: /rust-review

Agent:
# Rust Code Review Report

## Files Reviewed
- src/service/user.rs (modified)
- src/handler/api.rs (modified)

## Static Analysis Results
- Build: Successful
- Clippy: No warnings
- Formatting: Passed
- Tests: All passing

## Issues Found

[CRITICAL] Unchecked unwrap in Production Path
File: src/service/user.rs:28
Issue: Using `.unwrap()` on database query result
```rust
let user = db.find_by_id(id).unwrap();  // Panics on missing user
```
Fix: Propagate error with context
```rust
let user = db.find_by_id(id)
    .context("failed to fetch user")?;
```

[HIGH] Unnecessary Clone
File: src/handler/api.rs:45
Issue: Cloning String to satisfy borrow checker
```rust
let name = user.name.clone();
process(&user, &name);
```
Fix: Restructure to avoid clone
```rust
let result = process_name(&user.name);
use_user(&user, result);
```

## Summary
- CRITICAL: 1
- HIGH: 1
- MEDIUM: 0

Recommendation: Block merge until CRITICAL issue is fixed
````

## 批准标准

| 状态 | 条件 |
|--------|-----------|
| 批准 | 无关键或高优先级问题 |
| 警告 | 仅存在中优先级问题（谨慎合并） |
| 阻止 | 发现关键或高优先级问题 |

## 与其他命令的集成

* 首先使用 `/rust-test` 确保测试通过
* 如果出现构建错误，使用 `/rust-build`
* 提交前使用 `/rust-review`
* 对于非 Rust 专项问题，使用 `/code-review`

## 相关

* 代理：`agents/rust-reviewer.md`
* 技能：`skills/rust-patterns/`、`skills/rust-testing/`
