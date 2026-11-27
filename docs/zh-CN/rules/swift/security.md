---
paths:
  - "**/*.swift"
  - "**/Package.swift"
---

# Swift 安全

> 此文件扩展了 [common/security.md](../common/security.md)，并包含 Swift 特定的内容。

## 密钥管理

* 使用 **Keychain Services** 处理敏感数据（令牌、密码、密钥）—— 切勿使用 `UserDefaults`
* 使用环境变量或 `.xcconfig` 文件来管理构建时的密钥
* 切勿在源代码中硬编码密钥 —— 反编译工具可以轻易提取它们

```swift
let apiKey = ProcessInfo.processInfo.environment["API_KEY"]
guard let apiKey, !apiKey.isEmpty else {
    fatalError("API_KEY not configured")
}
```

## 传输安全

* 默认强制执行 App Transport Security (ATS) —— 不要禁用它
* 对关键端点使用证书锁定
* 验证所有服务器证书

## 输入验证

* 在显示之前清理所有用户输入，以防止注入攻击
* 使用带验证的 `URL(string:)`，而不是强制解包
* 在处理来自外部源（API、深度链接、剪贴板）的数据之前，先进行验证
