# Commands Quick Reference

> 59 slash commands installed globally. Type `/` in any Claude Code session to invoke.

---

## Core Workflow

| Command | What it does |
|---------|-------------|
| `/plan` | Restate requirements, assess risks, write step-by-step implementation plan — **waits for your confirm before touching code** |
| `/plan-canvas` | Open a plan or HTML artifact in the browser Plan Canvas — annotate elements, chat with the agent, approve or request changes in place |
| `/tdd` | Enforce test-driven development: scaffold interface → write failing test → implement → verify 80%+ coverage |
| `/code-review` | Full code quality, security, and maintainability review of changed files |
| `/build-fix` | Detect and fix build errors — delegates to the right build-resolver agent automatically |
| `/verify` | Run the full verification loop: build → lint → test → type-check |
| `/quality-gate` | Quality gate check against project standards |

---

## Testing

| Command | What it does |
|---------|-------------|
| `/tdd` | Universal TDD workflow (any language) |
| `/e2e` | Generate + run Playwright end-to-end tests, capture screenshots/videos/traces |
| `/test-coverage` | Report test coverage, identify gaps |
| `/go-test` | TDD workflow for Go (table-driven, 80%+ coverage with `go test -cover`) |
| `/kotlin-test` | TDD for Kotlin (Kotest + Kover) |
| `/rust-test` | TDD for Rust (cargo test, integration tests) |
| `/cpp-test` | TDD for C++ (GoogleTest + gcov/lcov) |

---

## Code Review

| Command | What it does |
|---------|-------------|
| `/code-review` | Universal code review |
| `/python-review` | Python — PEP 8, type hints, security, idiomatic patterns |
| `/go-review` | Go — idiomatic patterns, concurrency safety, error handling |
| `/kotlin-review` | Kotlin — null safety, coroutine safety, clean architecture |
| `/rust-review` | Rust — ownership, lifetimes, unsafe usage |
| `/cpp-review` | C++ — memory safety, modern idioms, concurrency |

---

## Build Fixers

| Command | What it does |
|---------|-------------|
| `/build-fix` | Auto-detect language and fix build errors |
| `/go-build` | Fix Go build errors and `go vet` warnings |
| `/kotlin-build` | Fix Kotlin/Gradle compiler errors |
| `/rust-build` | Fix Rust build + borrow checker issues |
| `/cpp-build` | Fix C++ CMake and linker problems |
| `/gradle-build` | Fix Gradle errors for Android / KMP |

---

## Planning & Architecture

| Command | What it does |
|---------|-------------|
| `/plan` | Implementation plan with risk assessment |
| `/multi-plan` | Multi-model collaborative planning |
| `/multi-workflow` | Multi-model collaborative development |
| `/multi-backend` | Backend-focused multi-model development |
| `/multi-frontend` | Frontend-focused multi-model development |
| `/multi-execute` | Multi-model collaborative execution |
| `/orchestrate` | Guide for tmux/worktree multi-agent orchestration |
| `/devfleet` | Orchestrate parallel Claude Code agents via DevFleet |

---

## Session Management

| Command | What it does |
|---------|-------------|
| `/save-session` | Save current session state to `~/.claude/session-data/` |
| `/resume-session` | Load the most recent saved session from the canonical session store and resume from where you left off |
| `/sessions` | Browse, search, and manage session history with aliases from `~/.claude/session-data/` (with legacy reads from `~/.claude/sessions/`) |
| `/checkpoint` | Mark a checkpoint in the current session |
| `/aside` | Answer a quick side question without losing current task context |
| `/context-budget` | Analyse context window usage — find token overhead, optimise |

---

## Learning & Improvement

| Command | What it does |
|---------|-------------|
| `/learn` | Extract reusable patterns from the current session |
| `/learn-eval` | Extract patterns + self-evaluate quality before saving |
| `/evolve` | Analyse learned instincts, suggest evolved skill structures |
| `/promote` | Promote project-scoped instincts to global scope |
| `/instinct-status` | Show all learned instincts (project + global) with confidence scores |
| `/instinct-export` | Export instincts to a file |
| `/instinct-import` | Import instincts from a file or URL |
| `/skill-create` | Analyse local git history → generate a reusable skill |
| `/skill-health` | Skill portfolio health dashboard with analytics |
| `/rules-distill` | Scan skills, extract cross-cutting principles, distill into rules |

---

## Refactoring & Cleanup

| Command | What it does |
|---------|-------------|
| `/refactor-clean` | Remove dead code, consolidate duplicates, clean up structure |
| `/prompt-optimize` | Analyse a draft prompt and output an optimised ECC-enriched version |

---

## Docs & Research

| Command | What it does |
|---------|-------------|
| `/docs` | Look up current library/API documentation via Context7 |
| `/update-docs` | Update project documentation |
| `/update-codemaps` | Regenerate codemaps for the codebase |

---

## Loops & Automation

| Command | What it does |
|---------|-------------|
| `/loop-start` | Start a recurring agent loop on an interval |
| `/loop-status` | Check status of running loops |
| `/claw` | Start NanoClaw v2 — persistent REPL with model routing, skill hot-load, branching, and metrics |

---

## Project & Infrastructure

| Command | What it does |
|---------|-------------|
| `/projects` | List known projects and their instinct statistics |
| `/harness-audit` | Audit the agent harness configuration for reliability and cost |
| `/eval` | Run the evaluation harness |
| `/model-route` | Route a task to the right model (Haiku / Sonnet / Opus) |
| `/pm2` | PM2 process manager initialisation |
| `/setup-pm` | Configure package manager (npm / pnpm / yarn / bun) |

---

## Quick Decision Guide

```
Starting a new feature?         → /plan first, then /tdd
Code just written?              → /code-review
Build broken?                   → /build-fix
Need live docs?                 → /docs <library>
Session about to end?           → /save-session or /learn-eval
Resuming next day?              → /resume-session
Context getting heavy?          → /context-budget then /checkpoint
Want to extract what you learned? → /learn-eval then /evolve
Running repeated tasks?         → /loop-start
```
