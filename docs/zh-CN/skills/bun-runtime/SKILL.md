---
name: bun-runtime
description: Bun 作为运行时、包管理器、打包器和测试运行器。何时选择 Bun 而非 Node、迁移注意事项以及 Vercel 支持。
origin: ECC
---

# Bun 运行时

Bun 是一个快速的全能 JavaScript 运行时和工具集：运行时、包管理器、打包器和测试运行器。

## 何时使用

* **优先选择 Bun** 用于：新的 JS/TS 项目、安装/运行速度很重要的脚本、使用 Bun 运行时的 Vercel 部署，以及当您想要单一工具链（运行 + 安装 + 测试 + 构建）时。
* **优先选择 Node** 用于：最大的生态系统兼容性、假定使用 Node 的遗留工具，或者当某个依赖项存在已知的 Bun 问题时。

在以下情况下使用：采用 Bun、从 Node 迁移、编写或调试 Bun 脚本/测试，或在 Vercel 或其他平台上配置 Bun。

## 工作原理

* **版本基线**：以下内容以 Bun 1.4.x 为准。CLI 参数可能在不同发行版本之间变化，依赖具体参数名之前请先用 `bun --version` 核实实际版本。
* **运行时**：开箱即用的 Node 兼容运行时（基于 JavaScriptCore）。自 Bun 1.4 起，运行时本身改用 Rust 实现（此前为 Zig）。并非 100% 兼容 Node——部分原生插件、较少使用的 `node:` 内部 API，以及依赖 Node 特定内部行为的包仍可能失败；生产环境依赖前请自行验证。
* **包管理器**：Bun 包含包管理器；安装性能取决于项目、网络状况和缓存状态。在当前 Bun 中，锁文件默认为 `bun.lock`（文本）；旧版本使用 `bun.lockb`（二进制），Bun 目前仍可读取该格式以便迁移，但新项目应使用 `bun.lock`。
* **打包器**：用于应用程序和库的内置打包器和转译器。
* **测试运行器**：内置的 `bun test`，具有类似 Jest 的 API。

**从 Node 迁移**：将 `node script.js` 替换为 `bun run script.js` 或 `bun script.js`。运行 `bun install` 代替 `npm install`；大多数包都能工作。使用 `bun run` 来执行 npm 脚本；使用 `bun x` 进行 npx 风格的临时运行。支持 Node 内置模块；在存在 Bun API 的地方优先使用它们以获得更好的性能。

**包与工作区命令**：`bun add <pkg>` / `bun remove <pkg>` / `bun update [pkg]` 管理依赖；`bun outdated` 列出过时的依赖。`bun pm ls` 使用锁文件列出项目依赖及解析后的版本，`--all` 包含传递依赖；它不检查已安装文件内容的完整性。[`bun audit`](https://bun.com/docs/pm/cli/audit) 使用 `bun.lock` 中的包名和版本查询注册表漏洞公告，不修改 `package.json`、`bun.lock` 或 `node_modules`。发送私有包元数据前，请确认获批的发送目标。若作用域注册表没有漏洞公告端点，对应包会被跳过，且不影响退出码。`bun audit fix` 会升级并安装依赖，修改锁文件和已安装的包，有时也修改直接依赖的固定版本；请将其作为会产生修改的安装操作进行审查，包括适用的生命周期脚本。`bun dedupe` 消除重复安装，`bun prune` 移除不再被引用的包。多包仓库（monorepo）通过根 `package.json` 中的 `workspaces` 数组配置（与 npm/yarn 相同的约定）；使用 `bun run --filter <pkg-name> <script>` 在指定工作区运行脚本。

**内置 API**：在添加依赖之前，优先考虑这些内置能力——文件 I/O 使用 `Bun.file` / `Bun.write`；内置 SQLite 数据库使用 `bun:sqlite`；HTTP/WebSocket 服务器使用 `Bun.serve`；SQL 数据库使用 [`Bun.sql`](https://bun.com/docs/runtime/sql)；Redis 使用 [`Bun.redis`](https://bun.com/docs/runtime/redis)；S3 兼容对象存储使用 [`Bun.S3Client`](https://bun.com/docs/runtime/s3)。其余新特性参见 [1.4 发布说明](https://bun.com/blog/bun-v1.4)。

**Vercel**：在 `vercel.json` 中设置 `bunVersion: "1.4.x"` 以使用 Bun 1.4（Rust 运行时）。详见 [Vercel 的 Bun 运行时文档](https://vercel.com/docs/functions/runtimes/bun)。构建命令：`bun run build` 或 `bun build ./src/index.ts --outdir=dist`。安装命令：`bun install --frozen-lockfile` 用于可重复的部署。

**参考**：[Bun 1.4 发布说明](https://bun.com/blog/bun-v1.4)。

## 示例

### 运行和安装

```bash
# Install dependencies (creates/updates bun.lock)
bun install

# Run a script or file
bun run dev
bun run src/index.ts
bun src/index.ts
```

### 脚本和环境变量

```bash
bun run --env-file=.env dev
FOO=bar bun run script.ts
```

### 测试

```bash
bun test
bun test --watch
```

Bun 1.4 中可用于 CI 的选项包括：选择受影响测试的 `bun test --changed[=<ref>]`、提供逐文件全局环境的 `bun test --isolate`、使用工作进程的 `bun test --parallel[=<n>]`，以及划分 CI 任务的 `bun test --shard=<n>/<count>`。`--isolate` 在同一进程内为每个文件创建新的 JavaScript 全局环境，并清理文档列出的逐文件资源；它不是进程或安全沙箱。`--parallel` 默认启用该选项。`--timings=<file>` 读取以往耗时以供调度，`--update-timings` 记录耗时。示例：`bun test --parallel --timings=./test-timings.json --update-timings`。为多个分片选择耗时文件路径前，请查阅已安装版本的帮助和文档。

```typescript
// test/example.test.ts
import { expect, test } from "bun:test";

test("add", () => {
  expect(1 + 2).toBe(3);
});
```

### 运行时 API

```typescript
const file = Bun.file("package.json");
const json = await file.json();

Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response("Hello");
  },
});
```

## 最佳实践

* 提交锁文件（`bun.lock`）以实现可重复的安装。
* 在脚本中优先使用 `bun run`。对于 TypeScript，Bun 原生运行 `.ts`。
* 保持依赖项最新；Bun 和生态系统发展迅速。
