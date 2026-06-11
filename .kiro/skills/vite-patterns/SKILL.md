---
name: vite-patterns
description: Vite build tool patterns including config, plugins, HMR, env variables, proxy setup, SSR, library mode, dependency pre-bundling, and build optimization. Activate when working with vite.config.ts, Vite plugins, or Vite-based projects.
origin: ECC
---

# Vite Patterns

Build tool and dev server patterns for Vite 8+ projects. Covers configuration, environment variables, proxy setup, library mode, dependency pre-bundling, and common production pitfalls.

## When to Use

- Configuring `vite.config.ts` or `vite.config.js`
- Setting up environment variables or `.env` files
- Configuring dev server proxy for API backends
- Optimizing build output (chunks, minification, assets)
- Publishing libraries with `build.lib`
- Troubleshooting dependency pre-bundling or CJS/ESM interop
- Debugging HMR, dev server, or build errors
- Choosing or ordering Vite plugins

## How It Works

- **Dev mode** serves source files as native ESM — no bundling. Transforms happen on-demand per module request, which is why cold starts are fast and HMR is precise.
- **Build mode** uses Rolldown (v7+) or Rollup (v5–v6) to bundle the app for production with tree-shaking, code-splitting, and Oxc-based minification.
- **Dependency pre-bundling** converts CJS/UMD deps to ESM once via esbuild and caches the result under `node_modules/.vite`, so subsequent starts skip the work.
- **Plugins** share a unified interface across dev and build — the same plugin object works for both the dev server's on-demand transforms and the production pipeline.
- **Environment variables** are statically inlined at build time. `VITE_`-prefixed vars become public constants in the bundle; everything unprefixed is invisible to client code.

## Examples

### Config Structure

#### Basic Config

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
})
```

#### Conditional Config

```typescript
// vite.config.ts
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd())   // VITE_ prefixed only (safe)

  return {
    plugins: [react()],
    server: command === 'serve' ? { port: 3000 } : undefined,
    define: {
      __API_URL__: JSON.stringify(env.VITE_API_URL),
    },
  }
})
```

#### Key Config Options

| Key | Default | Description |
|-----|---------|-------------|
| `root` | `'.'` | Project root (where `index.html` lives) |
| `base` | `'/'` | Public base path for deployed assets |
| `envPrefix` | `'VITE_'` | Prefix for client-exposed env vars |
| `build.outDir` | `'dist'` | Output directory |
| `build.minify` | `'oxc'` | Minifier (`'oxc'`, `'terser'`, or `false`) |
| `build.sourcemap` | `false` | `true`, `'inline'`, or `'hidden'` |

### Plugins

#### Essential Plugins

Most plugin needs are covered by a handful of well-maintained packages. Reach for these before writing your own.

| Plugin | Purpose | When to use |
|--------|---------|-------------|
| `@vitejs/plugin-react-swc` | React HMR + Fast Refresh via SWC | Default for React apps (faster than Babel variant) |
| `@vitejs/plugin-react` | React HMR + Fast Refresh via Babel | Only if you need Babel plugins (emotion, MobX decorators) |
| `@vitejs/plugin-vue` | Vue 3 SFC support | Vue apps |
| `vite-plugin-checker` | Runs `tsc` + ESLint in worker thread with HMR overlay | **Any TypeScript app** — Vite does NOT type-check during `vite build` |
| `vite-tsconfig-paths` | Honors `tsconfig.json` `paths` aliases | Any time you already have aliases in `tsconfig.json` |
| `vite-plugin-dts` | Emits `.d.ts` files in library mode | Publishing TypeScript libraries |
| `vite-plugin-svgr` | Imports SVGs as React components | React apps using SVGs as components |
| `rollup-plugin-visualizer` | Bundle treemap/sunburst report | Periodic bundle size audits (use `enforce: 'post'`) |
| `vite-plugin-pwa` | Zero-config PWA + Workbox | Offline-capable apps |

**Critical callout:** `vite build` transpiles but does NOT type-check. Type errors silently ship to production unless you add `vite-plugin-checker` or run `tsc --noEmit` in CI.

#### Authoring Custom Plugins

Authoring is rare — most needs are covered by existing plugins. When you do need one, start inline in `vite.config.ts` and only extract if reused.

```typescript
// vite.config.ts — minimal inline plugin
function myPlugin(): Plugin {
  return {
    name: 'my-plugin',                       // required, must be unique
    enforce: 'pre',                           // 'pre' | 'post' (optional)
    apply: 'build',                           // 'build' | 'serve' (optional)
    transform(code, id) {
      if (!id.endsWith('.custom')) return
      return { code: transformCustom(code), map: null }
    },
  }
}
```

**Key hooks:** `transform` (modify source), `resolveId` + `load` (virtual modules), `transformIndexHtml` (inject into HTML), `configureServer` (add dev middleware), `hotUpdate` (custom HMR — replaces deprecated `handleHotUpdate` in v7+).

**Virtual modules** use the `\0` prefix convention — `resolveId` returns `'\0virtual:my-id'` so other plugins skip it. User code imports `'virtual:my-id'`.

For full plugin API, see [vite.dev/guide/api-plugin](https://vite.dev/guide/api-plugin). Use `vite-plugin-inspect` during development to debug the transform pipeline.

### HMR API

Framework plugins (`@vitejs/plugin-react`, `@vitejs/plugin-vue`, etc.) handle HMR automatically. Reach for `import.meta.hot` directly only when building custom state stores, dev tools, or framework-agnostic utilities that need to persist state across updates.

```typescript
// src/store.ts — manual HMR for a vanilla module
if (import.meta.hot) {
  // Persist state across updates (must MUTATE, never reassign .data)
  import.meta.hot.data.count = import.meta.hot.data.count ?? 0

  // Cleanup side effects before module is replaced
  import.meta.hot.dispose((data) => clearInterval(data.intervalId))

  // Accept this module's own updates
  import.meta.hot.accept()
}
```

All `import.meta.hot` code is tree-shaken out of production builds — no guard removal needed.

### Environment Variables

Vite loads `.env`, `.env.local`, `.env.[mode]`, and `.env.[mode].local` in that order (later overrides earlier); `*.local` files are gitignored and meant for local secrets.

#### Client-Side Access

Only `VITE_`-prefixed vars are exposed to client code:

```typescript
import.meta.env.VITE_API_URL   // string
import.meta.env.MODE            // 'development' | 'production' | custom
import.meta.env.BASE_URL        // base config value
import.meta.env.DEV             // boolean
import.meta.env.PROD            // boolean
import.meta.env.SSR             // boolean
```

#### Using Env in Config

```typescript
// vite.config.ts
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())          // VITE_ prefixed only (safe)
  return {
    define: {
      __API_URL__: JSON.stringify(env.VITE_API_URL),
    },
  }
})
```

### Security

#### `VITE_` Prefix is NOT a Security Boundary

Any variable prefixed with `VITE_` is **statically inlined into the client bundle at build time**. Minification, base64 encoding, and disabling source maps do NOT hide it. A determined attacker can extract any `VITE_` var from the shipped JavaScript.

**Rule:** Only public values (API URLs, feature flags, public keys) go in `VITE_` vars. Secrets (API tokens, database URLs, private keys) MUST live server-side behind an API or serverless function.

#### The `loadEnv('')` Trap

```typescript
// BAD: passing '' as the third arg loads ALL env vars — including server secrets —
// and makes them available to inline into client code via `define`.
const env = loadEnv(mode, process.cwd(), '')

// GOOD: explicit prefix list
const env = loadEnv(mode, process.cwd(), ['VITE_', 'APP_'])
```

#### Source Maps in Production

Production source maps leak your original source code. Disable them unless you upload to an error tracker (Sentry, Bugsnag) and delete locally afterward:

```typescript
build: {
  sourcemap: false,                                  // default — keep it this way
}
```

#### `.gitignore` Checklist

- `.env.local`, `.env.*.local` — local secret overrides
- `dist/` — build output
- `node_modules/.vite` — pre-bundle cache (stale entries cause phantom errors)

### Server Proxy

```typescript
// vite.config.ts — server.proxy
server: {
  proxy: {
    '/foo': 'http://localhost:4567',                    // string shorthand

    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,                               // needed for virtual-hosted backends
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
  },
}
```

For WebSocket proxying, add `ws: true` to the route config.

### Build Optimization

#### Manual Chunks

```typescript
// vite.config.ts — build.rolldownOptions
build: {
  rolldownOptions: {
    output: {
      // Object form: group specific packages
      manualChunks: {
        'react-vendor': ['react', 'react-dom'],
        'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-popover'],
      },
    },
  },
}
```

```typescript
// Function form: split by heuristic
manualChunks(id) {
  if (id.includes('node_modules/react')) return 'react-vendor'
  if (id.includes('node_modules')) return 'vendor'
}
```

### Performance

#### Avoid Barrel Files

Barrel files (`index.ts` re-exporting everything from a directory) force Vite to load every re-exported file even when you import a single symbol. This is the #1 dev-server slowdown flagged by the official docs.

```typescript
// BAD — importing one util forces Vite to load the whole barrel
import { slash } from '@/utils'

// GOOD — direct import, only the one file is loaded
import { slash } from '@/utils/slash'
```

#### Be Explicit with Import Extensions

Each implicit extension forces up to 6 filesystem checks via `resolve.extensions`. In large codebases, this adds up.

```typescript
// BAD
import Component from './Component'

// GOOD
import Component from './Component.tsx'
```

Narrow `tsconfig.json` `allowImportingTsExtensions` + `resolve.extensions` to only the extensions you actually use.

#### Warm-Up Hot-Path Routes

`server.warmup.clientFiles` pre-transforms known hot entries before the browser requests them — eliminating the cold-load request waterfall on large apps.

```typescript
// vite.config.ts
server: {
  warmup: {
    clientFiles: ['./src/main.tsx', './src/routes/**/*.tsx'],
  },
}
```

#### Profiling Slow Dev Servers

When `vite dev` feels slow, start with `vite --profile`, interact with the app, then press `p+enter` to save a `.cpuprofile`. Load it in [Speedscope](https://www.speedscope.app) to find which plugins are eating time — usually `buildStart`, `config`, or `configResolved` hooks in community plugins.

### Library Mode

When publishing an npm package, use `build.lib`. Two footguns matter more than config detail:

1. **Types are not emitted** — add `vite-plugin-dts` or run `tsc --emitDeclarationOnly` separately.
2. **Peer dependencies MUST be externalized** — unlisted peers get bundled into your library, causing duplicate-runtime errors in consumers.

```typescript
// vite.config.ts
build: {
  lib: {
    entry: 'src/index.ts',
    formats: ['es', 'cjs'],
    fileName: (format) => `my-lib.${format}.js`,
  },
  rolldownOptions: {
    external: ['react', 'react-dom', 'react/jsx-runtime'],  // every peer dep
  },
}
```

### SSR Externals

Bare `createServer({ middlewareMode: true })` setups are framework-author territory. Most apps should use Nuxt, Remix, SvelteKit, Astro, or TanStack Start instead. What you *will* tweak as a framework user is the externals config when deps break in SSR:

```typescript
// vite.config.ts — ssr options
ssr: {
  external: ['node-native-package'],           // keep as require() in SSR bundle
  noExternal: ['esm-only-package'],            // force-bundle into SSR output (fixes most SSR errors)
  target: 'node',                              // 'node' or 'webworker'
}
```

### Dependency Pre-Bundling

Vite pre-bundles dependencies to convert CJS/UMD to ESM and reduce request count.

```typescript
// vite.config.ts — optimizeDeps
optimizeDeps: {
  include: [
    'lodash-es',                              // force pre-bundle known heavy deps
    'cjs-package',                            // CJS deps that cause interop issues
    'deep-lib/components/**',                 // glob for deep imports
  ],
  exclude: ['local-esm-package'],             // must be valid ESM if excluded
  force: true,                                // ignore cache, re-optimize (temporary debugging)
}
```

### Common Pitfalls

#### Dev Does Not Match Build

Dev uses esbuild/Rolldown for transforms; build uses Rolldown for bundling. CJS libraries can behave differently between the two. Always verify with `vite build && vite preview` before deploying.

#### Stale Chunks After Deployment

New builds produce new chunk hashes. Users with active sessions request old filenames that no longer exist. Vite has no built-in solution. Mitigations:

- Keep old `dist/assets/` files live for a deployment window
- Catch dynamic import errors in your router and force a page reload

#### Docker and Containers

Vite binds to `localhost` by default, which is unreachable from outside a container:

```typescript
// vite.config.ts — Docker/container setup
server: {
  host: true,                                  // bind 0.0.0.0
  hmr: { clientPort: 3000 },                   // if behind a reverse proxy
}
```

#### Monorepo File Access

Vite restricts file serving to the project root. Packages outside root are blocked:

```typescript
// vite.config.ts — monorepo file access
server: {
  fs: {
    allow: ['..'],                             // allow parent directory (workspace root)
  },
}
```

### Anti-Patterns

```typescript
// BAD: Setting envPrefix to '' exposes ALL env vars (including secrets) to the client
envPrefix: ''

// BAD: Assuming require() works in application source code — Vite is ESM-first
const lib = require('some-lib')                // use import instead

// BAD: Splitting every node_module into its own chunk — creates hundreds of tiny files
manualChunks(id) {
  if (id.includes('node_modules')) {
    return id.split('node_modules/')[1].split('/')[0]   // one chunk per package
  }
}

// BAD: Not externalizing peer deps in library mode — causes duplicate runtime errors
// build.lib without rolldownOptions.external

// BAD: Using deprecated esbuild minifier
build: { minify: 'esbuild' }                  // use 'oxc' (default) or 'terser'

// BAD: Mutating import.meta.hot.data by reassignment
import.meta.hot.data = { count: 0 }           // WRONG: must mutate properties, not reassign
import.meta.hot.data.count = 0                 // CORRECT
```

**Process anti-patterns:**

- **`vite preview` is NOT a production server** — it is a smoke test for the built bundle. Deploy `dist/` to a real static host (NGINX, Cloudflare Pages, Vercel static) or use a multi-stage Dockerfile.
- **Expecting `vite build` to type-check** — it only transpiles. Type errors silently ship to production. Add `vite-plugin-checker` or run `tsc --noEmit` in CI.
- **Shipping `@vitejs/plugin-legacy` by default** — it bloats bundles ~40%, breaks source-map bundle analyzers, and is unnecessary for the 95%+ of users on modern browsers. Gate it on real analytics, not assumption.
- **Hand-rolling 30+ `resolve.alias` entries that duplicate `tsconfig.json` paths** — use `vite-tsconfig-paths` instead. Observed in Excalidraw and PostHog; avoid in new projects.
- **Leaving stale `node_modules/.vite` after dep changes** — pre-bundle cache causes phantom errors. Clear it when switching branches or after patching deps.

## Quick Reference

| Pattern | When to Use |
|---------|-------------|
| `defineConfig` | Always — provides type inference |
| `loadEnv(mode, root, ['VITE_'])` | Access env vars in config (explicit prefix) |
| `vite-plugin-checker` | Any TypeScript app (fills the type-check gap) |
| `vite-tsconfig-paths` | Instead of hand-rolled `resolve.alias` |
| `optimizeDeps.include` | CJS deps causing interop issues |
| `server.proxy` | Route API requests to backend in dev |
| `server.host: true` | Docker, containers, remote access |
| `server.warmup.clientFiles` | Pre-transform hot-path routes |
| `build.lib` + `external` | Publishing npm packages |
| `manualChunks` (object) | Vendor bundle splitting |
| `vite --profile` | Debug slow dev server |
| `vite build && vite preview` | Smoke-test prod bundle locally (NOT a prod server) |

## Related Skills

- `frontend-patterns` — React component patterns
- `docker-patterns` — containerized dev with Vite
- `nextjs-turbopack` — alternative bundler for Next.js
