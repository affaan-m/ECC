# Index Script Spec — `scripts/index_repo.py`

> **Read in**: Phase 0, when the repo is judged large. Run the script and use `code-map.json` to build the course map and learn on demand — instead of cramming the whole repo into context.

## When you need the index

Phase 0 "large" judgment (any hit): ≥ 100k source lines, ≥ 20 top-level modules, or complex/multi-language dependencies. When unsure, actually measure with `find` + `wc -l`; don't guess.

## Run

```bash
python3 ~/.claude/skills/repo-mastery/scripts/index_repo.py <repo_path> -o <repo_path>/.learning/code-map.json
```

- Pure stdlib, **no dependencies to install**.
- Read-only scan; skips blacklisted dirs (`.git`, `node_modules`, `.venv`, `dist`, etc.).
- Writes to a temp file then atomically renames, so no half-written output.

## `code-map.json` structure

```jsonc
{
  "repo": "owner/name",
  "summary": {
    "total_source_files": 1234,
    "total_lines": 182340,
    "languages": { "python": 800, "typescript": 300 },
    "top_dirs": [ { "name": "deeptutor", "files": 600 } ]   // top-level dir stats
  },
  "entry_points": [ "package.json/main: src/index.js", "main.py" ],
  "dependency_graph": { "src/pipeline.py": ["deeptutor", "core"] },  // in-project edges only
  "files": [ { "path": "src/pipeline.py", "lang": "python", "lines": 640 } ],
  "symbol_lookup": { "python": [ "src/pipeline.py", "..." ] }  // heaviest 30 files per language
}
```

## How to use it for the course map (Phase 1)

1. **Module division** ← `summary.top_dirs` + `dependency_graph`: top-level dirs are natural module boundaries; clusters of dependency edges are strong "key implementations" candidates.
2. **Key-implementation location** ← `symbol_lookup` + `files` sorted by `lines` desc: the heaviest files are often core.
3. **Usage-module evidence** ← `entry_points`: entry files ground the "build / core workflows" modules.
4. **Read on demand during learning** ← from the map's knowledge points → the `path` in `files` → Read the relevant `file:line`. No more whole-repo scans.

## Known limitations (honest)

- Dependency extraction is **heuristic regex, not a syntax tree** — dynamic imports and indirect references are missed. It's for "finding candidates", not "exhaustive enumeration".
- Multi-language repos (e.g. Rust core + Python wrapper) are grouped by extension only; cross-language boundaries still need README/docs.
- For extreme monorepos (millions of lines), build an index per sub-directory, or index only the subsystem you care about.

## Where to put the index

- Default: `<repo>/.learning/code-map.json` (travels with the repo). For very large repos, `~/.repo-mastery/caches/<repo-id>/code-map.json` keeps the target repo clean — pick one and stay consistent.
