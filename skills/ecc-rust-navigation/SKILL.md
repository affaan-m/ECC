---
name: ecc-rust-navigation
description: Find Rust definitions, references, callers, trait implementations, and Cargo dependency paths, then make scoped symbol refactors using available tools.
---

# Rust navigation and refactoring

Adapted from the user-supplied `bol` navigation, call-graph, trait, symbol, dependency, and refactoring skills. Use semantic navigation when the environment actually provides it; do not invent `LSP`, `Task`, or editor API calls. Otherwise combine repository search with Cargo metadata and verify ambiguous results manually.

Establish the workspace root, selected packages, supported targets, features, and generated-code boundaries. Rust symbols with the same spelling can belong to distinct modules, cfg branches, macro expansions, or dependency versions.

For definitions and references:

1. Use `rg --files` to locate Rust sources and manifests; follow module declarations and re-exports.
2. Search the exact symbol with `rg -n '\bSymbolName\b'` over the relevant sources.
3. Inspect imports, type aliases, trait bounds, and nearby implementations to resolve identity. Text matches alone are not a complete reference set.
4. Include tests, benches, examples, public re-exports, documentation, and cfg-specific code when the requested change affects them.

For callers or trait implementations, use an available semantic call/type hierarchy if present. Otherwise inspect matched calls and `impl` blocks. Dynamic dispatch, function pointers, generated macros, and foreign callbacks can make the call graph incomplete; distinguish verified edges from inferred or unresolved edges. Do not label a text-search graph exhaustive.

For dependency analysis, start with commands matching the workspace's actual resolution and target:

```bash
cargo metadata --format-version 1 --no-deps --locked
cargo tree --locked
cargo tree --locked -d
```

Use `cargo tree -i` with a verified package specification to trace reverse dependencies; use `-e features` when feature activation is the question. Add target/feature flags that match the supported build. These commands can need cached dependencies or network access; when unavailable, report the limitation rather than silently updating `Cargo.lock`. Metadata with `--no-deps` is not a complete transitive dependency graph.

For rename/move/extract operations, preserve visibility, trait coherence, lifetimes, generic bounds, error behavior, and cfg coverage. Prefer a real semantic rename when available; a global text replacement can change unrelated symbols, strings, macros, or external API names. Read-only navigation does not imply permission to perform an unrelated refactor.

Review the diff and run the repository's targeted formatting, check, and test commands. A default-target build does not validate disabled cfg paths; state which supported variants were actually checked.
