---
name: ecc-typescript
description: Implement or review JavaScript and TypeScript modules, strict types, async code, and Vite configuration.
---

# JavaScript and TypeScript

Use the package manager, runtime, module format, compiler options, and lockfile
already selected by the project. Preserve plain JavaScript when migration to
TypeScript was not requested. Do not rewrite compiler settings to hide errors.

Model boundary data as unknown until validated. Prefer discriminated unions and
narrowing over assertions. Preserve error causes and cancellation through async
flows; handle rejected promises and cleanup on abort.

Run the existing typecheck, lint, build, and relevant tests. A Vite build alone
does not prove TypeScript type safety. New strictness flags need an intentional
migration if the existing project does not already support them.

For type design, module boundaries, or async patterns, read [patterns](references/patterns.md).
For Vite config, HMR, proxying, environment variables, or library builds, read [Vite](references/vite.md).
Check version-specific build options against the installed toolchain.
