---
name: swift-concurrency-6-2
description: Swift 6.2 可接近的并发性 — 默认单线程，@concurrent 用于显式后台卸载，隔离一致性用于主 actor 类型。
---

# Swift 6.2 可接近的并发

采用 Swift 6.2 并发模型的模式，其中代码默认在单线程上运行，并发是显式引入的。在无需牺牲性能的情况下消除常见的数据竞争错误。

## 何时启用

* 将 Swift 5.x 或 6.0/6.1 项目迁移到 Swift 6.2
* 解决数据竞争安全编译器错误
* 设计基于 MainActor 的应用架构
* 将 CPU 密集型工作卸载到后台线程
* 在 MainActor 隔离的类型上实现协议一致性
* 在 Xcode 26 中启用“可接近的并发”构建设置

## 核心问题：隐式的后台卸载

在 Swift 6.1 及更早版本中，异步函数可能会被隐式卸载到后台线程，即使在看似安全的代码中也会导致数据竞争错误：

```swift
// Swift 6.1: ERROR
@MainActor
final class StickerModel {
    let photoProcessor = PhotoProcessor()

    func extractSticker(_ item: PhotosPickerItem) async throws -> Sticker? {
        guard let data = try await item.loadTransferable(type: Data.self) else { return nil }

        // Error: Sending 'self.photoProcessor' risks causing data races
        return await photoProcessor.extractSticker(data: data, with: item.itemIdentifier)
    }
}
```

Swift 6.2 修复了这个问题：异步函数默认保持在调用者所在的 actor 上。

```swift
// Swift 6.2: OK — async stays on MainActor, no data race
@MainActor
final class StickerModel {
    let photoProcessor = PhotoProcessor()

    func extractSticker(_ item: PhotosPickerItem) async throws -> Sticker? {
        guard let data = try await item.loadTransferable(type: Data.self) else { return nil }
        return await photoProcessor.extractSticker(data: data, with: item.itemIdentifier)
    }
}
```

## 核心模式 — 隔离的一致性

MainActor 类型现在可以安全地符合非隔离协议：

```swift
protocol Exportable {
    func export()
}

// Swift 6.1: ERROR — crosses into main actor-isolated code
// Swift 6.2: OK with isolated conformance
extension StickerModel: @MainActor Exportable {
    func export() {
        photoProcessor.exportAsPNG()
    }
}
```

编译器确保该一致性仅在主 actor 上使用：

```swift
// OK — ImageExporter is also @MainActor
@MainActor
struct ImageExporter {
    var items: [any Exportable]

    mutating func add(_ item: StickerModel) {
        items.append(item)  // Safe: same actor isolation
    }
}

// ERROR — nonisolated context can't use MainActor conformance
nonisolated struct ImageExporter {
    var items: [any Exportable]

    mutating func add(_ item: StickerModel) {
        items.append(item)  // Error: Main actor-isolated conformance cannot be used here
    }
}
```

## 核心模式 — 全局和静态变量

使用 MainActor 保护全局/静态状态：

```swift
// Swift 6.1: ERROR — non-Sendable type may have shared mutable state
final class StickerLibrary {
    static let shared: StickerLibrary = .init()  // Error
}

// Fix: Annotate with @MainActor
@MainActor
final class StickerLibrary {
    static let shared: StickerLibrary = .init()  // OK
}
```

### MainActor 默认推断模式

Swift 6.2 引入了一种模式，默认推断 MainActor — 无需手动标注：

```swift
// With MainActor default inference enabled:
final class StickerLibrary {
    static let shared: StickerLibrary = .init()  // Implicitly @MainActor
}

final class StickerModel {
    let photoProcessor: PhotoProcessor
    var selection: [PhotosPickerItem]  // Implicitly @MainActor
}

extension StickerModel: Exportable {  // Implicitly @MainActor conformance
    func export() {
        photoProcessor.exportAsPNG()
    }
}
```

此模式是选择启用的，推荐用于应用、脚本和其他可执行目标。

## 核心模式 — 使用 @concurrent 进行后台工作

当需要真正的并行性时，使用 `@concurrent` 显式卸载：

> **重要：** 此示例需要启用“可接近的并发”构建设置 — SE-0466 (MainActor 默认隔离) 和 SE-0461 (默认非隔离非发送)。启用这些设置后，`extractSticker` 会保持在调用者所在的 actor 上，使得可变状态的访问变得安全。**如果没有这些设置，此代码存在数据竞争** — 编译器会标记它。

```swift
nonisolated final class PhotoProcessor {
    private var cachedStickers: [String: Sticker] = [:]

    func extractSticker(data: Data, with id: String) async -> Sticker {
        if let sticker = cachedStickers[id] {
            return sticker
        }

        let sticker = await Self.extractSubject(from: data)
        cachedStickers[id] = sticker
        return sticker
    }

    // Offload expensive work to concurrent thread pool
    @concurrent
    static func extractSubject(from data: Data) async -> Sticker { /* ... */ }
}

// Callers must await
let processor = PhotoProcessor()
processedPhotos[item.id] = await processor.extractSticker(data: data, with: item.id)
```

要使用 `@concurrent`：

1. 将包含类型标记为 `nonisolated`
2. 向函数添加 `@concurrent`
3. 如果函数还不是异步的，则添加 `async`
4. 在调用点添加 `await`

## 关键设计决策

| 决策 | 原理 |
|----------|-----------|
| 默认单线程 | 最自然的代码是无数据竞争的；并发是选择启用的 |
| 异步函数保持在调用者所在的 actor 上 | 消除了导致数据竞争错误的隐式卸载 |
| 隔离的一致性 | MainActor 类型可以符合协议，而无需不安全的变通方法 |
| `@concurrent` 显式选择启用 | 后台执行是一种有意的性能选择，而非偶然 |
| MainActor 默认推断 | 减少了应用目标中样板化的 `@MainActor` 标注 |
| 选择启用采用 | 非破坏性的迁移路径 — 逐步启用功能 |

## 迁移步骤

1. **在 Xcode 中启用**：构建设置中的 Swift Compiler > Concurrency 部分
2. **在 SPM 中启用**：在包清单中使用 `SwiftSettings` API
3. **使用迁移工具**：通过 swift.org/migration 进行自动代码更改
4. **从 MainActor 默认值开始**：为应用目标启用推断模式
5. **在需要的地方添加 `@concurrent`**：先进行性能分析，然后卸载热点路径
6. **彻底测试**：数据竞争问题会变成编译时错误

## 最佳实践

* **从 MainActor 开始** — 先编写单线程代码，稍后再优化
* **仅对 CPU 密集型工作使用 `@concurrent`** — 图像处理、压缩、复杂计算
* **为主要是单线程的应用目标启用 MainActor 推断模式**
* **在卸载前进行性能分析** — 使用 Instruments 查找实际的瓶颈
* **使用 MainActor 保护全局变量** — 全局/静态可变状态需要 actor 隔离
* **使用隔离的一致性**，而不是 `nonisolated` 变通方法或 `@Sendable` 包装器
* **增量迁移** — 在构建设置中一次启用一个功能

## 应避免的反模式

* 对每个异步函数都应用 `@concurrent`（大多数不需要后台执行）
* 在不理解隔离的情况下使用 `nonisolated` 来抑制编译器错误
* 当 actor 提供相同安全性时，仍保留遗留的 `DispatchQueue` 模式
* 在并发相关的 Foundation Models 代码中跳过 `model.availability` 检查
* 与编译器对抗 — 如果它报告数据竞争，代码就存在真正的并发问题
* 假设所有异步代码都在后台运行（Swift 6.2 默认：保持在调用者所在的 actor 上）

## 何时使用

* 所有新的 Swift 6.2+ 项目（“可接近的并发”是推荐的默认设置）
* 将现有应用从 Swift 5.x 或 6.0/6.1 并发迁移过来
* 在采用 Xcode 26 期间解决数据竞争安全编译器错误
* 构建以 MainActor 为中心的应用架构（大多数 UI 应用）
* 性能优化 — 将特定的繁重计算卸载到后台
