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

* **版本基线**：以下内容以 Bun 1.4.x 为准。CLI 参数在不同大版本之间有变化，依赖具体参数名之前请先用 `bun --version` 核实实际版本。
* **运行时**：开箱即用的 Node 兼容运行时（基于 JavaScriptCore）。自 Bun 1.4 起，运行时本身改用 Rust 实现（此前为 Zig）。并非 100% 兼容 Node——部分原生插件、较少使用的 `node:` 内部 API，以及依赖 Node 特定内部行为的包仍可能失败；生产环境依赖前请自行验证。
* **包管理器**：`bun install` 通常比 npm/yarn 更快；实际差距取决于项目规模、网络状况和缓存状态。在当前 Bun 中，锁文件默认为 `bun.lock`（文本）；旧版本使用 `bun.lockb`（二进制），Bun 目前仍可读取该格式以便迁移，但新项目应使用 `bun.lock`。
* **打包器**：用于应用程序和库的内置打包器和转译器。
* **测试运行器**：内置的 `bun test`，具有类似 Jest 的 API。

**从 Node 迁移**：将 `node script.js` 替换为 `bun run script.js` 或 `bun script.js`。运行 `bun install` 代替 `npm install`；大多数包都能工作。使用 `bun run` 来执行 npm 脚本；使用 `bun x` 进行 npx 风格的临时运行。支持 Node 内置模块；在存在 Bun API 的地方优先使用它们以获得更好的性能。

**包与工作区命令**：`bun add <pkg>` / `bun remove <pkg>` / `bun update [pkg]` 管理依赖；`bun outdated` 列出过时的依赖；`bun pm ls` 显示的是根据锁文件推导出的依赖树，并非磁盘上实际安装内容的证明。只读检查用 `bun audit` 读取 `bun.lock` 并将包列表发送至 npm 的漏洞公告端点（或各自的限定作用域注册表端点）以报告已知漏洞——该命令不会修改本地文件，但并非离线操作，因此在私有项目中应仅使用已获批准的注册表/公告端点，因为包名和版本（包括私有包）会被发送出去；会修改内容的命令有 `bun audit fix`（应用修复）、`bun dedupe`（消除重复安装）和 `bun prune`（移除不再被引用的包）。多包仓库（monorepo）通过根 `package.json` 中的 `workspaces` 数组配置（与 npm/yarn 相同的约定）；使用 `bun run --filter <pkg-name> <script>` 在指定工作区运行脚本。

**内置 API**：在添加依赖之前，优先考虑这些内置能力——文件 I/O 使用 `Bun.file` / `Bun.write`；内置 SQLite 数据库使用 `bun:sqlite`；HTTP/WebSocket 服务器使用 `Bun.serve`；SQL 数据库使用 [`Bun.sql`](https://bun.com/docs/runtime/sql)；Redis 使用 [`Bun.redis`](https://bun.com/docs/runtime/redis)；S3 兼容对象存储使用 [`Bun.S3Client`](https://bun.com/docs/runtime/s3)。其余新特性参见 [1.4 发布说明](https://bun.com/blog/bun-v1.4)。

**Vercel**：在 `vercel.json` 中设置 `bunVersion: "1.4.x"` 以使用 Bun 1.4（Rust 运行时）——目前 `"1.x"` 仍会解析到较旧的 1.3.14。详见 [Vercel 的 Bun 运行时文档](https://vercel.com/docs/functions/runtimes/bun)。构建命令：`bun run build` 或 `bun build ./src/index.ts --outdir=dist`。安装命令：`bun install --frozen-lockfile` 用于可重复的部署。

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

面向 CI，Bun 1.4 的测试运行器新增了：`bun test --changed[=<ref>]`（运行相对某个 git 提交/分支受影响的测试文件——不仅是被修改的测试文件本身，还包括依赖了被修改源文件的测试）、`bun test --isolate`（每个测试文件使用全新的全局对象运行，避免一个文件的句柄泄漏影响另一个文件；使用 `--parallel` 时默认启用）、`bun test --parallel[=<n>]`（用 N 个工作进程并行运行测试文件，默认等于 CPU 核心数）、`bun test --shard=<n>/<count>`（将一个测试套件拆分到多个 CI 运行器上）、以及 `bun test --timings=<file>`（读取 JSON 格式的单文件耗时数据，用于优先调度最慢的文件）配合 `--update-timings`（写入第一个指定的 `--timings` 路径——不带 `--shard` 时会合并进已有条目，带 `--shard` 时只会把当前分片的文件写入同一个首个 `--timings` 路径——Bun 不会自动为每个分片选择不同的输出路径，因此需要为每个分片指定不同的输出路径，避免覆盖其他分片的耗时记录；多次指定 `--timings=<file>`，例如每个分片一个，可将它们合并为一张表一起读取）。示例：`bun test --parallel --timings=./test-timings.json --update-timings`。具体参数行为请以本地 `bun test --help` 输出为准。

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
