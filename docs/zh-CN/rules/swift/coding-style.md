---
paths:
  - "**/*.swift"
  - "**/Package.swift"
---

# Swift 编码风格

> 本文件在 [common/coding-style.md](../common/coding-style.md) 的基础上扩展了 Swift 相关的内容。

## 格式化

* **SwiftFormat** 用于自动格式化，**SwiftLint** 用于风格检查
* `swift-format` 已作为替代方案捆绑在 Xcode 16+ 中

## 不变性

* 优先使用 `let` 而非 `var` — 将所有内容定义为 `let`，仅在编译器要求时才改为 `var`
* 默认使用具有值语义的 `struct`；仅在需要标识或引用语义时才使用 `class`

## 命名

遵循 [Apple API 设计指南](https://www.swift.org/documentation/api-design-guidelines/)：

* 在使用时保持清晰 — 省略不必要的词语
* 根据方法和属性的作用而非类型来命名
* 对于常量，使用 `static let` 而非全局常量

## 错误处理

使用类型化 throws (Swift 6+) 和模式匹配：

```swift
func load(id: String) throws(LoadError) -> Item {
    guard let data = try? read(from: path) else {
        throw .fileNotFound(id)
    }
    return try decode(data)
}
```

## 并发

启用 Swift 6 严格并发检查。优先使用：

* `Sendable` 值类型用于跨越隔离边界的数据
* Actors 用于共享可变状态
* 结构化并发 (`async let`, `TaskGroup`) 而非非结构化的 `Task {}`
