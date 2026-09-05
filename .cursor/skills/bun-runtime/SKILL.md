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

- **Version baseline**: guidance below targets Bun 1.4.x. Check the actual version with `bun --version` before relying on flag names, since CLI flags have changed across major versions.
- **Runtime**: Drop-in Node-compatible runtime, built on JavaScriptCore. As of Bun 1.4 the runtime itself is implemented in Rust (migrated from Zig). Not 100% Node-compatible — some native addons, less-common `node:` internal APIs, and packages that depend on Node-specific internals can still fail; verify before depending on it in production.
- **Package manager**: `bun install` is typically faster than npm/yarn; actual gains depend on project size, network conditions, and cache state. Lockfile is `bun.lock` (text) by default in current Bun; older versions used `bun.lockb` (binary) — Bun still reads that format for migration, but new projects should use `bun.lock`.
- **Bundler**: Built-in bundler and transpiler for apps and libraries.
- **Test runner**: Built-in `bun test` with a Jest-like API.

**Migration from Node**: Replace `node script.js` with `bun run script.js` or `bun script.js`. Run `bun install` in place of `npm install`; most packages work. Use `bun run` for npm scripts; `bun x` for npx-style one-off runs. Node built-ins are supported; prefer Bun APIs where they exist for better performance.

**Package and workspace commands**: `bun add <pkg>` / `bun remove <pkg>` / `bun update [pkg]` manage dependencies; `bun outdated` lists stale deps; `bun pm ls` shows the dependency tree derived from the lockfile (not a listing of what's actually on disk). Read-only inspection: `bun audit` reads `bun.lock` and sends the package list to the npm advisory endpoint (or each scoped registry's own advisory endpoint) to report known vulnerabilities — it doesn't touch local files, but it isn't offline, so on private projects only use an approved registry/advisory endpoint, since package names and versions (including private ones) leave the machine. Modifying: `bun audit fix` applies fixes, `bun dedupe` collapses duplicate installs, and `bun prune` removes packages no longer referenced. Monorepos use a root `workspaces` array in `package.json` (same convention as npm/yarn); run a script in one workspace with `bun run --filter <pkg-name> <script>`.

**Built-in APIs**: reach for these before adding a dependency — `Bun.file` / `Bun.write` for file I/O, `bun:sqlite` for an embedded SQLite database, `Bun.serve` for an HTTP/WebSocket server, [`Bun.sql`](https://bun.com/docs/runtime/sql) for SQL databases, [`Bun.redis`](https://bun.com/docs/runtime/redis) for Redis, and [`Bun.S3Client`](https://bun.com/docs/runtime/s3) for S3-compatible object storage. See the [1.4 release notes](https://bun.com/blog/bun-v1.4) for the rest of what's new.

**Vercel**: Set `bunVersion: "1.4.x"` in `vercel.json` to use Bun 1.4 (Rust runtime) — `"1.x"` currently still resolves to the older 1.3.14. See [Vercel's Bun runtime docs](https://vercel.com/docs/functions/runtimes/bun). Build: `bun run build` or `bun build ./src/index.ts --outdir=dist`. Install: `bun install --frozen-lockfile` for reproducible deploys.

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

For CI, Bun 1.4's test runner adds: `bun test --changed[=<ref>]` (run test files affected by changes vs. a git commit/branch — includes tests exercising changed source files, not just edited test files), `bun test --isolate` (fresh global object per test file, so leaked handles in one file can't affect another; implied by `--parallel`), `bun test --parallel[=<n>]` (run test files across N worker processes, defaults to CPU core count), `bun test --shard=<n>/<count>` (split one suite across CI runners), and `bun test --timings=<file>` (reads JSON per-file duration data to front-load the slowest files) with `--update-timings` (writes to the first `--timings` path given — without `--shard` it merges into existing entries; with `--shard` it writes only the current shard's files to that same first `--timings` path — Bun does not pick a different path per shard automatically, so choose a distinct output path for each shard to avoid overwriting other shards' timing records; pass `--timings` multiple times, once per shard file, to read them together as a single combined table). Example: `bun test --parallel --timings=./test-timings.json --update-timings`. Run `bun test --help` locally to confirm exact flag behavior for your installed version.

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
