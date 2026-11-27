---
name: nextjs-turbopack
description: Next.js 16+ 和 Turbopack — 增量打包、文件系统缓存、开发速度，以及何时使用 Turbopack 与 webpack。
origin: ECC
---

# Next.js 与 Turbopack

Next.js 16+ 在本地开发中默认使用 Turbopack：这是一个用 Rust 编写的增量捆绑器，能显著加快开发启动和热更新的速度。

## 何时使用

* **Turbopack (默认开发模式)**：用于日常开发。冷启动和热模块替换速度更快，尤其是在大型应用中。
* **Webpack (旧版开发模式)**：仅当遇到 Turbopack 错误或依赖仅在开发中可用的 webpack 插件时使用。可通过 `--webpack`（或 `--no-turbopack`，具体取决于你的 Next.js 版本；请查阅你所用版本的文档）来禁用。
* **生产环境**：生产构建行为 (`next build`) 可能使用 Turbopack 或 webpack，这取决于 Next.js 版本；请查阅你所用版本的官方 Next.js 文档。

适用场景：开发或调试 Next.js 16+ 应用，诊断开发启动或热模块替换速度慢的问题，或优化生产环境捆绑包。

## 工作原理

* **Turbopack**：用于 Next.js 开发的增量捆绑器。利用文件系统缓存，因此重启速度要快得多（例如，在大型项目中快 5–14 倍）。
* **开发环境默认启用**：从 Next.js 16 开始，`next dev` 默认使用 Turbopack，除非被禁用。
* **文件系统缓存**：重启时会复用之前的工作成果；缓存通常位于 `.next` 下；基本使用无需额外配置。
* **捆绑包分析器 (Next.js 16.1+)**：实验性的捆绑包分析器，用于检查输出并发现重型依赖；可通过配置或实验性标志启用（请查阅你所用版本的 Next.js 文档）。

## 示例

### 命令

```bash
next dev
next build
next start
```

### 使用

运行 `next dev` 以使用 Turbopack 进行本地开发。使用捆绑包分析器（参见 Next.js 文档）来优化代码分割并剔除大型依赖。尽可能优先使用 App Router 和服务器组件。

## 最佳实践

* 保持使用较新的 Next.js 16.x 版本，以获得稳定的 Turbopack 和缓存行为。
* 如果开发速度慢，请确保你正在使用 Turbopack（默认），并且缓存没有被不必要地清除。
* 对于生产环境捆绑包大小问题，请使用你所用版本的官方 Next.js 捆绑包分析工具。
