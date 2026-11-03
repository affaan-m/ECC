---
name: ecc-zig
description: Implement, review, and test Zig code, explicit allocator ownership, error unions, C interop, and version-specific build APIs.
---

# Zig systems development

Read `build.zig.zon`, `build.zig`, toolchain pins (`mise.toml`, `.tool-versions`,
CI), and `zig version`. Zig standard-library, I/O, networking, and build APIs
change between releases: inspect the installed standard library and documentation
matching the pinned version before using an unfamiliar API. Do not silently
upgrade the compiler or copy master-version APIs into a stable project.

Make allocator and resource ownership visible in API contracts. Pair successful
acquisition with `defer`; use `errdefer` for error-path rollback and partial
initialization. Keep borrowed slices within their owner's lifetime. Treat
`undefined` as uninitialized storage, never as a usable value. Prefer slices
with explicit bounds over unchecked pointers and casts.

Use error unions for recoverable failures and handle each error where recovery
is possible; preserve unexpected errors. Do not convert arbitrary failures into
`unreachable`. Check integer narrowing, overflow, alignment, sentinel lifetimes,
and C ABI/layout assumptions. `extern` layouts and packed layouts serve different purposes.

For sockets/event loops, track descriptor ownership, nonblocking readiness,
partial reads/writes, cancellation, deadlines, backpressure, and stale event
dispatch after slot/descriptor reuse. Derive hot-path allocation requirements
from the project specification and measurements.

Run repository task scripts first. Typical checks, when the project supports them:

```sh
zig fmt --check .
zig build test
zig build test -Doptimize=ReleaseSafe
zig build -Doptimize=ReleaseSafe
```

Use `std.testing.allocator` for allocator-owning tests, cover error cleanup,
and use allocation-failure helpers only as supported by the pinned compiler.
Do not claim leak-free or allocation-free behavior from a successful build.

The [official language documentation](https://ziglang.org/documentation/) and
the installed compiler's standard-library sources are the primary API references.
