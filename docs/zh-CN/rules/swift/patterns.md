---
paths:
  - "**/*.swift"
  - "**/Package.swift"
---

# Swift 模式

> 此文件使用 Swift 特定内容扩展了 [common/patterns.md](../common/patterns.md)。

## 面向协议的设计

定义小型、专注的协议。使用协议扩展来提供共享的默认实现：

```swift
protocol Repository: Sendable {
    associatedtype Item: Identifiable & Sendable
    func find(by id: Item.ID) async throws -> Item?
    func save(_ item: Item) async throws
}
```

## 值类型

* 使用结构体（struct）作为数据传输对象和模型
* 使用带有关联值的枚举（enum）来建模不同的状态：

```swift
enum LoadState<T: Sendable>: Sendable {
    case idle
    case loading
    case loaded(T)
    case failed(Error)
}
```

## Actor 模式

使用 actor 来处理共享可变状态，而不是锁或调度队列：

```swift
actor Cache<Key: Hashable & Sendable, Value: Sendable> {
    private var storage: [Key: Value] = [:]

    func get(_ key: Key) -> Value? { storage[key] }
    func set(_ key: Key, value: Value) { storage[key] = value }
}
```

## 依赖注入

使用默认参数注入协议 —— 生产环境使用默认值，测试时注入模拟对象：

```swift
struct UserService {
    private let repository: any UserRepository

    init(repository: any UserRepository = DefaultUserRepository()) {
        self.repository = repository
    }
}
```

## 参考

查看技能：`swift-actor-persistence` 以了解基于 actor 的持久化模式。
查看技能：`swift-protocol-di-testing` 以了解基于协议的依赖注入和测试。
