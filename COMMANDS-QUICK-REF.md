# Commands Quick Reference

> 84 slash commands installed globally. Type `/` in any Claude Code session to invoke.

---

## Core Workflow

| Command | What it does |
|---------|-------------|
| `/plan` | Restate requirements, assess risks, write step-by-step implementation plan — **waits for your confirm before touching code** |
| `/plan-prd` | Generate a lean, problem-first PRD and hand off to `/plan` for implementation planning |
| `/feature-dev` | Guided feature development with codebase understanding and architecture focus |
| `/code-review` | Code review — local uncommitted changes or GitHub PR (pass PR number/URL for PR mode) |
| `/review-pr` | Comprehensive PR review using specialized agents |
| `/build-fix` | Detect and fix build errors — delegates to the right build-resolver agent automatically |
| `/quality-gate` | Quality gate check against project standards |
| `/santa-loop` | Adversarial dual-review convergence loop — two independent model reviewers must both approve before code ships |

---

## Testing

| Command | What it does |
|---------|-------------|
| `/test-coverage` | Analyze coverage, identify gaps, and generate missing tests toward the target threshold |
| `/go-test` | TDD workflow for Go (table-driven, 80%+ coverage with `go test -cover`) |
| `/kotlin-test` | TDD for Kotlin (Kotest + Kover) |
| `/rust-test` | TDD for Rust (cargo test, `cargo-llvm-cov`) |
| `/cpp-test` | TDD for C++ (GoogleTest + gcov/lcov) |
| `/flutter-test` | Run Flutter/Dart tests (unit, widget, golden, integration), report and fix failures |
| `/react-test` | TDD for React (React Testing Library, Vitest or Jest, coverage targets) |

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
| `/flutter-review` | Flutter/Dart — widget best practices, state management, accessibility, security |
| `/react-review` | React/JSX — hook correctness, render performance, server/client boundaries, accessibility |
| `/fastapi-review` | FastAPI — async correctness, dependency injection, Pydantic schemas, security |

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
| `/flutter-build` | Fix Dart analyzer errors and Flutter build failures |
| `/react-build` | Fix React build failures (Vite, webpack, Next.js, CRA, Parcel, esbuild, Bun) |

---

## Orchestrated Feature Workflows

| Command | What it does |
|---------|-------------|
| `/orch-add-feature` | Build a brand-new feature end to end — research, plan, TDD, review, gated commit |
| `/orch-build-mvp` | Bootstrap a working MVP from a design/spec doc — ingest, slice, scaffold, TDD, review, gated commit |
| `/orch-change-feature` | Alter an existing feature to new desired behavior — update tests to the new spec, change impl, review, gated commit |
| `/orch-fix-defect` | Fix a bug — reproduce it as a failing regression test, fix to green, review, gated commit |
| `/orch-refine-code` | Behavior-preserving refactor — confirm tests green, restructure, keep green, review, gated commit |

---

## PRP Workflow

| Command | What it does |
|---------|-------------|
| `/prp-prd` | Interactive PRD generator — problem-first, hypothesis-driven, back-and-forth questioning |
| `/prp-plan` | Create a comprehensive feature implementation plan with codebase analysis and pattern extraction |
| `/prp-implement` | Execute an implementation plan with rigorous validation loops |
| `/prp-commit` | Quick commit with natural language file targeting |
| `/prp-pr` | Create a GitHub PR from the current branch with unpushed commits |

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

---

## Session Management

| Command | What it does |
|---------|-------------|
| `/save-session` | Save current session state to `~/.claude/session-data/` |
| `/resume-session` | Load the most recent saved session from the canonical session store and resume from where you left off |
| `/sessions` | Browse, search, and manage session history with aliases from `~/.claude/session-data/` (with legacy reads from `~/.claude/sessions/`) |
| `/checkpoint` | Create, verify, or list workflow checkpoints after running verification checks |
| `/aside` | Answer a quick side question without losing current task context |

---

## Learning & Improvement

| Command | What it does |
|---------|-------------|
| `/learn` | Extract reusable patterns from the current session |
| `/learn-eval` | Extract patterns + self-evaluate quality before saving |
| `/evolve` | Analyse learned instincts, suggest evolved skill structures |
| `/promote` | Promote project-scoped instincts to global scope |
| `/prune` | Delete pending instincts older than 30 days that were never promoted |
| `/instinct-status` | Show all learned instincts (project + global) with confidence scores |
| `/instinct-export` | Export instincts to a file |
| `/instinct-import` | Import instincts from a file or URL |
| `/skill-create` | Analyse local git history → generate a reusable skill |
| `/skill-health` | Skill portfolio health dashboard with analytics |

---

## Refactoring & Cleanup

| Command | What it does |
|---------|-------------|
| `/refactor-clean` | Remove dead code, consolidate duplicates, clean up structure |

---

## Docs & Research

| Command | What it does |
|---------|-------------|
| `/ecc-guide` | Navigate ECC's current agents, skills, commands, hooks, install profiles, and docs from the live repository surface |
| `/update-docs` | Sync documentation from source-of-truth files such as scripts, schemas, routes, and exports |
| `/update-codemaps` | Regenerate codemaps for the codebase |

---

## Loops & Automation

| Command | What it does |
|---------|-------------|
| `/loop-start` | Start a recurring agent loop on an interval |
| `/loop-status` | Check status of running loops |
| `/gan-build` | Generator/evaluator build loop for implementation tasks, bounded iterations and scoring |
| `/gan-design` | Generator/evaluator design loop for frontend or visual work, bounded iterations and scoring |

---

## Project & Infrastructure

| Command | What it does |
|---------|-------------|
| `/projects` | List known projects and their instinct statistics |
| `/project-init` | Detect a project's stack and produce a dry-run ECC onboarding plan |
| `/harness-audit` | Audit the agent harness configuration for reliability and cost |
| `/model-route` | Route a task to the right model (Haiku / Sonnet / Opus) |
| `/pm2` | PM2 process manager initialisation |
| `/setup-pm` | Configure package manager (npm / pnpm / yarn / bun) |
| `/auto-update` | Pull the latest ECC repo changes and reinstall the current managed targets |
| `/cost-report` | Generate a local Claude Code cost report from a cost-tracker SQLite database |
| `/security-scan` | Run AgentShield against agent, hook, MCP, permission, and secret surfaces |
| `/jira` | Retrieve a Jira ticket, analyze requirements, update status, or add comments |
| `/pr` | Create a GitHub PR from current branch with unpushed commits |
| `/hookify` | Create hooks to prevent unwanted behaviors from conversation analysis or explicit instructions |
| `/hookify-configure` | Enable or disable hookify rules interactively |
| `/hookify-list` | List all configured hookify rules |
| `/hookify-help` | Get help with the hookify system |

---

## Marketing

| Command | What it does |
|---------|-------------|
| `/marketing-campaign` | Plan and execute a full marketing campaign — positioning, landing page copy, email sequence, social posts, ad variants, video scripts, content calendar |

---

## Retired Commands

These slash commands were retired in favor of skills. The command files still exist under `legacy-command-shims/commands/` for backward compatibility (not part of the default installed surface), but the maintained workflow now lives in the listed skill — invoke the skill directly instead:

| Retired command | Use this skill instead |
|---|---|
| `/tdd` | `tdd-workflow` |
| `/eval` | `eval-harness` |
| `/verify` | `verification-loop` |
| `/e2e` | `e2e-testing` |
| `/docs` | `documentation-lookup` |
| `/claw` | `nanoclaw-repl` |
| `/context-budget` | `context-budget` |
| `/devfleet` | `claude-devfleet` |
| `/orchestrate` | `dmux-workflows` and `autonomous-agent-harness` |
| `/prompt-optimize` | `prompt-optimizer` |
| `/rules-distill` | `rules-distill` |

---

## Quick Decision Guide

```
Starting a new feature?         → /plan first, then TDD via the tdd-workflow skill
Code just written?              → /code-review
Build broken?                   → /build-fix
Need live docs?                 → the documentation-lookup skill
Session about to end?           → /save-session or /learn-eval
Resuming next day?              → /resume-session
Context getting heavy?          → the context-budget skill, then /checkpoint
Want to extract what you learned? → /learn-eval then /evolve
Running repeated tasks?         → /loop-start
```
