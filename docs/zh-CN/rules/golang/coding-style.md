---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---

# Go 编码风格

> 本文件在 [common/coding-style.md](../common/coding-style.md) 的基础上，扩展了 Go 语言的特定内容。

## 格式化

* **gofmt** 和 **goimports** 是强制性的 —— 无需进行风格辩论

## 设计原则

* 接受接口，返回结构体
* 保持接口小巧（1-3 个方法）

## 错误处理

始终用上下文包装错误：

```go
if err != nil {
    return fmt.Errorf("failed to create user: %w", err)
}
```

## 参考

查看技能：`golang-patterns` 以获取全面的 Go 语言惯用法和模式。
