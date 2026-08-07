# Curriculum Design — Designing the Course Map from Source

> **Read in**: Phase 1. Your job is to turn a source repo's *structure tree* into a learning *route*. The learner is you (a developer), and the goal is to fully understand the project: **usage → architecture → key implementations**.

## The core move: reference → route (absorbed from docs-to-course)

Source repos are organized for *lookup* (by module, by directory, by language convention). A course is organized for *learning* — each step earns the next. **Do not mirror the directory tree; re-sequence it.**

The spine of a code-learning course:

> **First win (build) → overall architecture mental model → core workflows/modules → key implementations → hands-on labs → troubleshooting → deep references**

## The module menu (a menu, not a checklist)

Each candidate module comes from real repo evidence — files, directories, build config, README, issues. Pick 4–8; fewer, deeper is better.

| # | Module | Where it comes from | Why a developer cares |
|---|---|---|---|
| 1 | **Build & environment** | README quickstart, Dockerfile, Makefile, pyproject/package.json | Trust. Seeing it run gives every later code discussion a vehicle. **Almost always keep.** |
| 2 | **Overall architecture mental model** | top-level dirs, entry files (main/app/__init__), dependency graph, README architecture section | Lets you predict behavior instead of memorizing code line by line. |
| 3 | **Core workflows** | high-frequency entry APIs, CLI commands, main request-response paths | The "how to use it" body. |
| 4 | **Key implementations (internals)** | core algorithms, data structures, async/concurrency mechanisms, plugin/extension points | **This skill's signature module** — docs-to-course explicitly avoids it; we specialize in it. |
| 5 | **Hands-on labs** | test suites, examples dir, modifiable demos | Turns "understood" into "can do". |
| 6 | **Troubleshooting & boundaries** | common issues, error paths, exception handling, config traps | Lets you stand on your own when things break. |
| 7 | **Deep references** | API docs, contributing guide, internal design docs | Your self-service entry after the course. |

**How to choose**:
- Small CLI/lib: modules 1, 2, 3, 5, 6. ~5 modules.
- Medium app: 1, 2, 3, 4, 5, 6. ~6 modules.
- Large platform (multi-language/multi-entry/plugin ecosystem): all of 1–7; split "key implementations" into several modules if needed. Use the parallel build path.

## Knowledge points: granularity and type

Break each module into **3–8 knowledge points**. Granularity rule of thumb: *each knowledge point should be a unit you can answer "do I know it or not" in one word*. One point = one judgeable interaction; never vague.

Every knowledge point must have a `type` (it decides the gate; see `mastery-policy.md`):

| type | Meaning (for code learning) | Gate | Example |
|---|---|---|---|
| `memory` | remembered APIs/commands/key constants | quantitative (quiz) | "syntax of `deeptutor kb create`" |
| `procedure` | can operate: build/run/call | quantitative + hands-on | "build and launch the project from scratch" |
| `concept` | understand core concepts/data structures | qualitative (Feynman recital) | "understand the RAG retrieval flow" |
| `design` | can explain why it's designed this way / extend it | qualitative + design tradeoff follow-ups | "why message queue instead of RPC" |

> A common mistake is over-coarse points ("understand the system architecture"). Split to judgeable units: "dependency direction between modules", "the complete call chain of a request", "config load precedence".

## Generate from evidence, not invention

Every module/knowledge point must point to **concrete evidence in the repo**:

- Module → top-level dir or core file path.
- Knowledge point → specific file/function/doc section.
- Key-implementation module → the file and entry function where that code lives.

If you have no evidence for a module while designing the map, either go read it or leave it out. **Better one fewer module than one that's hollow.**

## Pre-scan order (explore_context style)

1. README / top-level docs — how the repo wants to be understood.
2. Build config (pyproject.toml / package.json / Cargo.toml / Makefile / Dockerfile) — how it runs.
3. Directory structure & entry files (`find` top-level + read `main`/`app`/`__init__.py`).
4. Core modules — read the 3–5 heaviest at interface level.
5. Tests & examples — see the real usage.

**Stay objective**: this phase only *maps*; conclusions come in the explanation phase.
