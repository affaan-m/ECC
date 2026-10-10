---
name: bun-runtime
description: Bun as runtime, package manager, bundler, and test runner. When to choose Bun vs Node, migration notes, and Vercel support.
origin: ECC
---

# Bun Runtime

Bun is a fast all-in-one JavaScript runtime and toolkit: runtime, package manager, bundler, and test runner.

## When to Use

- **Prefer Bun** for: new JS/TS projects, scripts where install/run speed matters, Vercel deployments with Bun runtime, and when you want a single toolchain (run + install + test + build).
- **Prefer Node** for: maximum ecosystem compatibility, legacy tooling that assumes Node, or when a dependency has known Bun issues.

Use when: adopting Bun, migrating from Node, writing or debugging Bun scripts/tests, or configuring Bun on Vercel or other platforms.

## How It Works

- **Version baseline**: guidance below targets Bun 1.4.x. Check the actual version with `bun --version` before relying on flag names, since CLI flags can change between releases.
- **Runtime**: Drop-in Node-compatible runtime, built on JavaScriptCore. As of Bun 1.4 the runtime itself is implemented in Rust (migrated from Zig). Not 100% Node-compatible — some native addons, less-common `node:` internal APIs, and packages that depend on Node-specific internals can still fail; verify before depending on it in production.
- **Package manager**: Bun includes a package manager; installation performance depends on the project, network conditions, and cache state. Lockfile is `bun.lock` (text) by default in current Bun; older versions used `bun.lockb` (binary) — Bun still reads that format for migration, but new projects should use `bun.lock`.
- **Bundler**: Built-in bundler and transpiler for apps and libraries.
- **Test runner**: Built-in `bun test` with a Jest-like API.

**Migration from Node**: Replace `node script.js` with `bun run script.js` or `bun script.js`. Run `bun install` in place of `npm install`; most packages work. Use `bun run` for npm scripts; `bun x` for npx-style one-off runs. Node built-ins are supported; prefer Bun APIs where they exist for better performance.

**Package and workspace commands**: `bun add <pkg>` / `bun remove <pkg>` / `bun update [pkg]` manage dependencies; `bun outdated` lists stale deps. `bun pm ls` lists project dependencies and resolved versions using the lockfile; `--all` includes transitive dependencies. It is not an integrity check of installed file contents. [`bun audit`](https://bun.com/docs/pm/cli/audit) queries registry advisories using package names and versions from `bun.lock`; it does not modify `package.json`, `bun.lock`, or `node_modules`. Review approved destinations before sending private package metadata. Packages whose scoped registry lacks an advisory endpoint are skipped and do not affect the exit code. `bun audit fix` upgrades and installs dependencies, changing the lockfile and installed packages and sometimes direct version pins; review it as a modifying install operation, including applicable lifecycle scripts. `bun dedupe` collapses duplicate installs, and `bun prune` removes packages no longer referenced. Monorepos use a root `workspaces` array in `package.json` (same convention as npm/yarn); run a script in one workspace with `bun run --filter <pkg-name> <script>`.

**Built-in APIs**: reach for these before adding a dependency — `Bun.file` / `Bun.write` for file I/O, `bun:sqlite` for an embedded SQLite database, `Bun.serve` for an HTTP/WebSocket server, [`Bun.sql`](https://bun.com/docs/runtime/sql) for SQL databases, [`Bun.redis`](https://bun.com/docs/runtime/redis) for Redis, and [`Bun.S3Client`](https://bun.com/docs/runtime/s3) for S3-compatible object storage. See the [1.4 release notes](https://bun.com/blog/bun-v1.4) for the rest of what's new.

**Vercel**: Set `bunVersion: "1.4.x"` in `vercel.json` to use Bun 1.4 (Rust runtime). See [Vercel's Bun runtime docs](https://vercel.com/docs/functions/runtimes/bun). Build: `bun run build` or `bun build ./src/index.ts --outdir=dist`. Install: `bun install --frozen-lockfile` for reproducible deploys.

**Reference**: [Bun 1.4 release notes](https://bun.com/blog/bun-v1.4).

## Examples

### Run and install

```bash
# Install dependencies (creates/updates bun.lock)
bun install

# Run a script or file
bun run dev
bun run src/index.ts
bun src/index.ts
```

### Scripts and env

```bash
bun run --env-file=.env dev
FOO=bar bun run script.ts
```

### Testing

```bash
bun test
bun test --watch
```

For CI on Bun 1.4, available options include `bun test --changed[=<ref>]` for affected tests, `bun test --isolate` for per-file globals, `bun test --parallel[=<n>]` for worker processes, and `bun test --shard=<n>/<count>` for CI partitioning. `--isolate` creates a fresh JavaScript global for each file in the same process and cleans up documented per-file resources; it is not a process or security sandbox. `--parallel` enables it by default. `--timings=<file>` reads prior durations for scheduling; `--update-timings` records durations. Example: `bun test --parallel --timings=./test-timings.json --update-timings`. Check the installed version's help and documentation before choosing timing-file paths for a multi-shard workflow.

```typescript
// test/example.test.ts
import { expect, test } from "bun:test";

test("add", () => {
  expect(1 + 2).toBe(3);
});
```

### Runtime API

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

## Best Practices

- Commit the lockfile (`bun.lock`) for reproducible installs.
- Prefer `bun run` for scripts. For TypeScript, Bun runs `.ts` natively.
- Keep dependencies up to date; Bun and the ecosystem evolve quickly.
