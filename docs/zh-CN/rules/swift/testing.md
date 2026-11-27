---
paths:
  - "**/*.swift"
  - "**/Package.swift"
---

# Swift 测试

> 本文档在 [common/testing.md](../common/testing.md) 的基础上扩展了 Swift 特定的内容。

## 框架

对于新测试，使用 **Swift Testing** (`import Testing`)。使用 `@Test` 和 `#expect`：

```swift
@Test("User creation validates email")
func userCreationValidatesEmail() throws {
    #expect(throws: ValidationError.invalidEmail) {
        try User(email: "not-an-email")
    }
}
```

## 测试隔离

每个测试都会获得一个全新的实例 —— 在 `init` 中设置，在 `deinit` 中拆卸。测试之间没有共享的可变状态。

## 参数化测试

```swift
@Test("Validates formats", arguments: ["json", "xml", "csv"])
func validatesFormat(format: String) throws {
    let parser = try Parser(format: format)
    #expect(parser.isValid)
}
```

## 覆盖率

```bash
swift test --enable-code-coverage
```

## 参考

关于基于协议的依赖注入和 Swift Testing 的模拟模式，请参阅技能：`swift-protocol-di-testing`。
