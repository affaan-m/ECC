---
description: "Agent orchestration: ecc: namespacing, agent catalog, parallel execution, multi-perspective analysis"
alwaysApply: true
---

# Agent Orchestration

## Agent Names Are Namespaced (CRITICAL)

ECC agents are plugin agents. They MUST be referenced with the `ecc:` prefix:

- `ecc:planner` ✅ resolves
- `planner` ❌ does not resolve

The 68 ECC agent definitions live in the plugin at `~/.claude/plugins/marketplaces/ecc/agents/`.

### Exception: local user agents

Agents you define yourself under `~/.claude/agents/` are user agents, not plugin agents, and
resolve **without** the `ecc:` prefix — even when the file sits in an `ecc/` subfolder. That
folder is organization only; it does not create a namespace.

```
~/.claude/plugins/marketplaces/ecc/agents/planner.md   -> ecc:planner
~/.claude/agents/my-agent.md                           -> my-agent
~/.claude/agents/ecc/my-agent.md                       -> my-agent   (still no prefix)
```

Rule of thumb: if the name appears in the tables below, use `ecc:`. If it is your own file
under `~/.claude/agents/`, use the bare name. When in doubt, check `/agents`.

## Core Agents

Daily workflow agents, all namespaced:

| Agent | Purpose |
|-------|---------|
| **ecc:planner** | Implementation planning |
| **ecc:architect** | System design and architectural decisions |
| **ecc:code-architect** | Feature architecture blueprints from existing codebase patterns |
| **ecc:code-explorer** | Deep analysis of existing features and execution paths |
| **ecc:code-reviewer** | Code review after writing/modifying code |
| **ecc:security-reviewer** | Security analysis before commits |
| **ecc:tdd-guide** | Test-driven development for new features and bug fixes |
| **ecc:build-error-resolver** | General build/type error resolution |
| **ecc:e2e-runner** | E2E testing of critical user flows |
| **ecc:refactor-cleaner** | Dead code cleanup and code maintenance |
| **ecc:doc-updater** | Documentation and codemaps |
| **ecc:performance-optimizer** | Bottleneck identification and optimization |
| **ecc:code-simplifier** | Simplification while preserving behavior |
| **ecc:agent-evaluator** | Output quality scoring on a 5-axis rubric |

## Language & Framework Reviewers

Choose by the language/framework of the files under review:

| Agent | Scope |
|-------|-------|
| **ecc:typescript-reviewer** | TypeScript/JavaScript |
| **ecc:react-reviewer** | React/JSX |
| **ecc:vue-reviewer** | Vue/Nuxt/Pinia |
| **ecc:python-reviewer** | Python |
| **ecc:fastapi-reviewer** | FastAPI |
| **ecc:django-reviewer** | Django/DRF |
| **ecc:go-reviewer** | Go |
| **ecc:rust-reviewer** | Rust |
| **ecc:java-reviewer** | Java (Spring Boot/Quarkus) |
| **ecc:kotlin-reviewer** | Kotlin/Android/KMP |
| **ecc:swift-reviewer** | Swift |
| **ecc:flutter-reviewer** | Flutter/Dart |
| **ecc:php-reviewer** | PHP |
| **ecc:csharp-reviewer** | C#/.NET |
| **ecc:fsharp-reviewer** | F# |
| **ecc:cpp-reviewer** | C++ |
| **ecc:database-reviewer** | PostgreSQL/SQL/Supabase |
| **ecc:mle-reviewer** | ML/MLOps code |
| **ecc:rag-pipeline-reviewer** | RAG pipelines, vector stores, retrieval quality |

## Build Error Resolvers

Choose by the toolchain that failed. For generic TypeScript/build errors, use **ecc:build-error-resolver** (Core):

| Agent | Toolchain |
|-------|-----------|
| **ecc:react-build-resolver** | React (Vite, webpack, Next.js, CRA, esbuild, Bun) |
| **ecc:django-build-resolver** | Django/Python (pip, Poetry, migrations) |
| **ecc:go-build-resolver** | Go (build, vet, linters) |
| **ecc:rust-build-resolver** | Rust/Cargo |
| **ecc:java-build-resolver** | Java/Maven/Gradle (Spring Boot, Quarkus) |
| **ecc:kotlin-build-resolver** | Kotlin/Gradle |
| **ecc:swift-build-resolver** | Swift/Xcode/SPM |
| **ecc:cpp-build-resolver** | C++/CMake |
| **ecc:dart-build-resolver** | Dart/Flutter |
| **ecc:pytorch-build-resolver** | PyTorch/CUDA |
| **ecc:harmonyos-app-resolver** | HarmonyOS/ArkTS |

## Specialist Agents

The rest of the fleet — delegate when the task matches their specialty:

| Agent | Purpose |
|-------|---------|
| **ecc:a11y-architect** | WCAG 2.2 accessibility design and audits |
| **ecc:chief-of-staff** | Email/Slack/LINE/Messenger triage |
| **ecc:comment-analyzer** | Code comment accuracy and rot risk |
| **ecc:conversation-analyzer** | Find behaviors worth preventing with hooks |
| **ecc:docs-lookup** | Context7 documentation lookup |
| **ecc:gan-planner** | GAN harness: expand prompt into full spec |
| **ecc:gan-generator** | GAN harness: implement to spec |
| **ecc:gan-evaluator** | GAN harness: score live app against rubric |
| **ecc:harness-optimizer** | Improve local agent harness config |
| **ecc:healthcare-reviewer** | EMR/EHR clinical safety and PHI compliance |
| **ecc:homelab-architect** | Home/small-lab network plans |
| **ecc:loop-operator** | Operate and intervene in autonomous loops |
| **ecc:marketing-agent** | Marketing strategy and copy |
| **ecc:network-architect** | Enterprise/multi-site network design |
| **ecc:network-config-reviewer** | Router/switch config review |
| **ecc:network-troubleshooter** | Connectivity/routing/DNS diagnostics |
| **ecc:opensource-forker** | Open-source pipeline: fork and strip |
| **ecc:opensource-sanitizer** | Open-source pipeline: verify sanitization |
| **ecc:opensource-packager** | Open-source pipeline: packaging |
| **ecc:pr-test-analyzer** | PR test coverage quality |
| **ecc:seo-specialist** | Technical SEO audits |
| **ecc:silent-failure-hunter** | Swallowed errors, bad fallbacks |
| **ecc:spec-miner** | Extract behavioral specs for OpenSpec |
| **ecc:type-design-analyzer** | Type design analysis |

## Immediate Agent Usage

No user prompt needed:
1. Complex feature requests - Use **ecc:planner** agent
2. Code just written/modified - Use **ecc:code-reviewer** agent
3. Bug fix or new feature - Use **ecc:tdd-guide** agent
4. Architectural decision - Use **ecc:architect** agent
5. Security-sensitive change (auth, user input, secrets, DB, external API) - Use **ecc:security-reviewer** agent

## Parallel Task Execution

ALWAYS use parallel Task execution for independent operations:

```markdown
# GOOD: Parallel execution — one message, multiple agent calls
Launch 3 agents in parallel:
1. Agent 1: **ecc:security-reviewer** — security analysis of auth module
2. Agent 2: **ecc:performance-optimizer** — performance review of cache system
3. Agent 3: **ecc:typescript-reviewer** — type checking of utilities

# BAD: Sequential when unnecessary
First agent 1, then agent 2, then agent 3
```

## Delegation Completion Contract

Applies to every agent at every depth (parent, child, grandchild):

1. **Your final message IS the deliverable.** Never end your turn with "waiting for background agents" — a spawned task is not a completed task. Ending your turn while children are running orphans their results (completed children cannot notify a parent whose turn has ended).
2. **If you delegate, you own collection.** Wait for results, integrate them, then return. Fire-and-forget delegation is forbidden.
3. **Decompose only when the work cannot fit in one context.** Do not re-delegate a task already sized for a single agent — depth is an outcome, not a plan.

> Rationale: observed failure mode — research agents followed "Parallel Task Execution" above, spawned children, and returned "waiting" as their final answer. All children completed successfully but their results were orphaned. The parallel rule without a completion contract produces zombie tasks.

## Multi-Perspective Analysis

For complex problems, use split role sub-agents:
- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
- Redundancy checker

## If An Agent Type Fails To Resolve

1. Retry once with the `ecc:` prefix (`planner` → `ecc:planner`)
2. Check the available agents list (`/agents`) for the exact name
3. Report the failure to the user — never absorb the work inline pretending the delegation happened
