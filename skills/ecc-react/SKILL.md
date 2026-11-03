---
name: ecc-react
description: Build, review, test, and profile React components, hooks, effects, and server/client boundaries.
---

# React development

Match the project's React version, rendering framework, and client/server
boundaries. Keep effects for synchronization with external systems; derive
values during rendering when possible. Preserve stable keys and state ownership.

Check effect cleanup, stale closures, abort behavior, and the rules of hooks.
Keep server-only data and credentials out of client modules. Add memoization
when profiling or an explicit identity contract justifies it.

For component design, hooks, state, forms, or Suspense, read [patterns](references/patterns.md).
For component/hook tests, read [testing](references/testing.md).
For a measured rendering, bundle, or data-fetching problem, read
[performance](references/performance.md); verify API advice against the installed React/framework version.
