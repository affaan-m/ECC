# Everything Claude Code for Kiro

Bring [Everything Claude Code](https://github.com/anthropics/courses/tree/master/everything-claude-code) (ECC) workflows to [Kiro](https://kiro.dev). This repository provides custom agents, skills, hooks, steering files, and scripts that can be installed into any Kiro project with a single command.

## Quick Start

```bash
# Go to .kiro folder
cd .kiro

# Install to your project
./install.sh /path/to/your/project

# Or install to the current directory
./install.sh

# Or install globally (applies to all Kiro projects)
./install.sh ~
```

The installer uses non-destructive copy — it will not overwrite your existing files.

## Component Inventory

| Component | Count | Location |
|-----------|-------|----------|
| Agents (JSON) | 33 | `.kiro/agents/*.json` |
| Agents (MD) | 33 | `.kiro/agents/*.md` |
| Skills | 43 | `.kiro/skills/*/SKILL.md` |
| Steering Files | 22 | `.kiro/steering/*.md` |
| IDE Hooks | 13 | `.kiro/hooks/*.kiro.hook` |
| Scripts | 2 | `.kiro/scripts/*.sh` |
| MCP Examples | 1 | `.kiro/settings/mcp.json.example` |
| Documentation | 5 | `docs/*.md` |

## What's Included

### Agents

Agents are specialized AI assistants with specific tool configurations.

**Format:**
- **IDE**: Markdown files (`.md`) - Access via automatic selection or explicit invocation
- **CLI**: JSON files (`.json`) - Access via `/agent swap` command

Both formats are included for maximum compatibility.

> **Note:** Agent models are determined by your current model selection in Kiro, not by the agent configuration.

| Agent | Description |
|-------|-------------|
| `planner` | Expert planning specialist for complex features and refactoring. Read-only tools for safe analysis. |
| `code-reviewer` | Senior code reviewer ensuring quality and security. Reviews code for CRITICAL security issues, code quality, React/Next.js patterns, and performance. |
| `tdd-guide` | Test-Driven Development specialist enforcing write-tests-first methodology. Ensures 80%+ test coverage with comprehensive test suites. |
| `security-reviewer` | Security vulnerability detection and remediation specialist. Flags secrets, SSRF, injection, unsafe crypto, and OWASP Top 10 vulnerabilities. |
| `architect` | Software architecture specialist for system design, scalability, and technical decision-making. Read-only tools for safe analysis. |
| `build-error-resolver` | Build and TypeScript error resolution specialist. Fixes build/type errors with minimal diffs, no architectural changes. |
| `doc-updater` | Documentation and codemap specialist. Updates codemaps and documentation, generates docs/CODEMAPS/*, updates READMEs. |
| `refactor-cleaner` | Dead code cleanup and consolidation specialist. Removes unused code, duplicates, and refactors safely. |
| `go-reviewer` | Go code review specialist. Reviews Go code for idiomatic patterns, error handling, concurrency, and performance. |
| `python-reviewer` | Python code review specialist. Reviews Python code for PEP 8, type hints, error handling, and best practices. |
| `typescript-reviewer` | TypeScript/JavaScript code reviewer. Type safety, async correctness, Node/web security, and idiomatic patterns. |
| `rust-reviewer` | Rust code reviewer. Ownership, lifetimes, error handling, unsafe usage, and idiomatic patterns. |
| `rust-build-resolver` | Rust/Cargo build error resolution specialist. Fixes compilation, dependency, and linking errors. |
| `kotlin-reviewer` | Kotlin/Android/KMP code reviewer. Coroutine safety, Compose best practices, clean architecture. |
| `kotlin-build-resolver` | Kotlin/Gradle build error resolution specialist. Fixes Gradle, KSP, and dependency errors. |
| `java-reviewer` | Java/Spring Boot/Quarkus code reviewer. Enterprise patterns, security, and performance. |
| `java-build-resolver` | Java/Maven/Gradle build error resolution specialist. Fixes compilation and dependency errors. |
| `cpp-reviewer` | C++ code reviewer. Memory safety, modern C++, RAII, and performance patterns. |
| `cpp-build-resolver` | C++/CMake build error resolution specialist. Fixes compilation, linking, and CMake errors. |
| `django-reviewer` | Django code reviewer. ORM patterns, DRF, migrations, and Django security. |
| `swift-reviewer` | Swift code reviewer. Concurrency, ARC, protocols, and SwiftUI patterns. |
| `fsharp-reviewer` | F# functional code reviewer. Immutability, pattern matching, and type-driven design. |
| `react-reviewer` | React code reviewer. Component patterns, hooks, performance, and accessibility. |
| `react-build-resolver` | React/Next.js build error resolution specialist. Fixes bundler, SSR, and hydration errors. |
| `pytorch-build-resolver` | PyTorch runtime/CUDA/training error resolution specialist. |
| `mle-reviewer` | Production ML engineering reviewer. Pipelines, evals, serving, monitoring, and rollback. |
| `performance-optimizer` | Performance analysis and optimization specialist. Profiling, bottleneck detection, and tuning. |
| `database-reviewer` | Database and SQL specialist. Reviews schema design, queries, migrations, and database security. |
| `e2e-runner` | End-to-end testing specialist. Creates and maintains E2E tests using Playwright or Cypress. |
| `harness-optimizer` | Test harness optimization specialist. Improves test performance, reliability, and maintainability. |
| `loop-operator` | Verification loop operator. Runs comprehensive checks and iterates until all pass. |
| `chief-of-staff` | Executive assistant for project management, coordination, and strategic planning. |
| `go-build-resolver` | Go build error resolution specialist. Fixes Go compilation errors, dependency issues, and build problems. |

**Usage in IDE:**
- You can run an agent in `/` in a Kiro session, e.g., `/code-reviewer`.
- Kiro's Spec session has native planner, designer, and architects that can be used instead of `planner` and `architect` agents.

**Usage in CLI:**
1. Start a chat session
2. Type `/agent swap` to see available agents
3. Select an agent to switch (e.g., `code-reviewer` after writing code)
4. Or start with a specific agent: `kiro-cli --agent planner`


### Skills

Skills are on-demand workflows invocable via the `/` menu in chat.

| Skill | Description |
|-------|-------------|
| `tdd-workflow` | Enforces test-driven development with 80%+ coverage including unit, integration, and E2E tests. Use when writing new features or fixing bugs. |
| `coding-standards` | Universal coding standards and best practices for TypeScript, JavaScript, React, and Node.js. Use when starting projects, reviewing code, or refactoring. |
| `security-review` | Comprehensive security checklist and patterns. Use when adding authentication, handling user input, creating API endpoints, or working with secrets. |
| `verification-loop` | Comprehensive verification system that runs build, type check, lint, tests, security scan, and diff review. Use after completing features or before creating PRs. |
| `api-design` | RESTful API design patterns and best practices. Use when designing new APIs or refactoring existing endpoints. |
| `frontend-patterns` | React, Next.js, and frontend architecture patterns. Use when building UI components or optimizing frontend performance. |
| `backend-patterns` | Node.js, Express, and backend architecture patterns. Use when building APIs, services, or backend infrastructure. |
| `e2e-testing` | End-to-end testing with Playwright or Cypress. Use when adding E2E tests or improving test coverage. |
| `golang-patterns` | Go idioms, concurrency patterns, and best practices. Use when writing Go code or reviewing Go projects. |
| `golang-testing` | Go testing patterns with table-driven tests and benchmarks. Use when writing Go tests or improving test coverage. |
| `python-patterns` | Python idioms, type hints, and best practices. Use when writing Python code or reviewing Python projects. |
| `python-testing` | Python testing with pytest and coverage. Use when writing Python tests or improving test coverage. |
| `database-migrations` | Database schema design and migration patterns. Use when creating migrations or refactoring database schemas. |
| `postgres-patterns` | PostgreSQL-specific patterns and optimizations. Use when working with PostgreSQL databases. |
| `docker-patterns` | Docker and containerization best practices. Use when creating Dockerfiles or optimizing container builds. |
| `deployment-patterns` | Deployment strategies and CI/CD patterns. Use when setting up deployments or improving CI/CD pipelines. |
| `search-first` | Search-first development methodology. Use when exploring unfamiliar codebases or debugging issues. |
| `agentic-engineering` | Agentic software engineering patterns and workflows. Use when working with AI agents or building agentic systems. |
| `rust-patterns` | Idiomatic Rust patterns, ownership, error handling, traits, and concurrency. Use when writing Rust code. |
| `rust-testing` | Rust testing patterns including unit, integration, async, property-based testing, and coverage. |
| `kotlin-patterns` | Idiomatic Kotlin patterns, coroutines, null safety, and DSL builders. Use when writing Kotlin code. |
| `kotlin-testing` | Kotlin testing with Kotest, MockK, coroutine testing, and Kover coverage. |
| `java-coding-standards` | Java coding standards for Spring Boot and Quarkus services. |
| `jpa-patterns` | JPA/Hibernate patterns for entity design, relationships, and query optimization. |
| `springboot-patterns` | Spring Boot architecture patterns, REST API design, and layered services. |
| `springboot-security` | Spring Security best practices for authn/authz, validation, and secrets. |
| `django-patterns` | Django architecture patterns, REST API design with DRF, and ORM best practices. |
| `django-security` | Django security best practices, authentication, and CSRF/XSS prevention. |
| `fastapi-patterns` | FastAPI patterns for async APIs, dependency injection, and Pydantic models. |
| `nestjs-patterns` | NestJS architecture patterns for modules, controllers, and providers. |
| `react-patterns` | React 18/19 patterns including hooks, server/client components, and Suspense. |
| `react-testing` | React component testing with Testing Library, Vitest/Jest, and MSW. |
| `nextjs-turbopack` | Next.js 16+ and Turbopack incremental bundling patterns. |
| `cpp-coding-standards` | C++ coding standards based on C++ Core Guidelines. |
| `cpp-testing` | C++ testing with GoogleTest, CTest, and sanitizers. |
| `swift-actor-persistence` | Thread-safe data persistence in Swift using actors. |
| `swift-protocol-di-testing` | Protocol-based dependency injection for testable Swift code. |
| `mle-workflow` | Production ML engineering workflow for training, evaluation, deployment, and monitoring. |
| `pytorch-patterns` | PyTorch deep learning patterns for training pipelines and model architectures. |
| `deep-research` | Multi-source deep research with synthesis and source attribution. |
| `strategic-compact` | Context management and manual compaction suggestions at logical intervals. |
| `autonomous-loops` | Patterns for autonomous agent loops — sequential pipelines to multi-agent DAGs. |
| `content-hash-cache-pattern` | Cache expensive file processing using SHA-256 content hashes. |

**Usage:**

1. Type `/` in chat to open the skills menu
2. Select a skill (e.g., `tdd-workflow` when starting a new feature, `security-review` when adding auth)
3. The agent will guide you through the workflow with specific instructions and checklists

**Note:** For planning complex features, use the `planner` agent instead (see Agents section above).

### Steering Files

Steering files provide always-on rules and context that shape how the agent works with your code.

| File | Inclusion | Description |
|------|-----------|-------------|
| `coding-style.md` | auto | Core coding style rules: immutability, file organization, error handling, and code quality standards. Loaded in every conversation. |
| `security.md` | auto | Security best practices including mandatory checks, secret management, and security response protocol. Loaded in every conversation. |
| `testing.md` | auto | Testing requirements: 80% coverage minimum, TDD workflow, and test types (unit, integration, E2E). Loaded in every conversation. |
| `development-workflow.md` | auto | Development process, PR workflow, and collaboration patterns. Loaded in every conversation. |
| `git-workflow.md` | auto | Git commit conventions, branching strategies, and version control best practices. Loaded in every conversation. |
| `patterns.md` | auto | Common design patterns and architectural principles. Loaded in every conversation. |
| `performance.md` | auto | Performance optimization guidelines and profiling strategies. Loaded in every conversation. |
| `lessons-learned.md` | auto | Project-specific patterns and learnings. Edit this file to capture your team's conventions. Loaded in every conversation. |
| `typescript-patterns.md` | fileMatch: `*.ts,*.tsx` | TypeScript-specific patterns, type safety, and best practices. Loaded when editing TypeScript files. |
| `python-patterns.md` | fileMatch: `*.py` | Python-specific patterns, type hints, and best practices. Loaded when editing Python files. |
| `golang-patterns.md` | fileMatch: `*.go` | Go-specific patterns, concurrency, and best practices. Loaded when editing Go files. |
| `swift-patterns.md` | fileMatch: `*.swift` | Swift-specific patterns and best practices. Loaded when editing Swift files. |
| `rust-patterns.md` | fileMatch: `*.rs` | Rust ownership, lifetimes, error handling, and idiomatic patterns. Loaded when editing Rust files. |
| `kotlin-patterns.md` | fileMatch: `*.kt` | Kotlin coroutines, Compose, and Android/KMP best practices. Loaded when editing Kotlin files. |
| `java-patterns.md` | fileMatch: `*.java` | Java patterns, Spring Boot, and enterprise best practices. Loaded when editing Java files. |
| `cpp-patterns.md` | fileMatch: `*.cpp,*.hpp,*.h,*.cc,*.cxx` | C++ RAII, smart pointers, and modern C++ patterns. Loaded when editing C++ files. |
| `php-patterns.md` | fileMatch: `*.php` | PHP patterns, Laravel, and modern PHP best practices. Loaded when editing PHP files. |
| `ruby-patterns.md` | fileMatch: `*.rb` | Ruby patterns and Rails best practices. Loaded when editing Ruby files. |
| `typescript-security.md` | fileMatch: `*.ts,*.tsx` | TypeScript security patterns. Loaded when editing TypeScript files. |
| `dev-mode.md` | manual | Development context mode. Invoke with `#dev-mode` for focused development. |
| `review-mode.md` | manual | Code review context mode. Invoke with `#review-mode` for thorough reviews. |
| `research-mode.md` | manual | Research context mode. Invoke with `#research-mode` for exploration and learning. |

Steering files with `auto` inclusion are loaded automatically. No action needed — they apply as soon as you install them.

To create your own, add a markdown file to `.kiro/steering/` with YAML frontmatter:

```yaml
---
inclusion: auto        # auto | fileMatch | manual
description: Brief explanation of what this steering file contains
fileMatchPattern: "*.ts"  # required if inclusion is fileMatch
---

Your rules here...
```

### Hooks

Kiro supports two types of hooks:

1. **IDE Hooks** - Standalone JSON files in `.kiro/hooks/` (for Kiro IDE)
2. **CLI Hooks** - Embedded in agent configurations (for `kiro-cli`)

#### IDE Hooks (Standalone Files)

These hooks appear in the Agent Hooks panel in the Kiro IDE and can be toggled on/off. Hook files use the `.kiro.hook` extension.

| Hook | Trigger | Action | Description |
|------|---------|--------|-------------|
| `quality-gate` | Manual (`userTriggered`) | `runCommand` | Runs build, type check, lint, and tests via `quality-gate.sh`. Click to trigger comprehensive quality checks. |
| `typecheck-on-edit` | File edited (`*.ts`, `*.tsx`) | `askAgent` | Checks for type errors when TypeScript files are edited to catch issues early. |
| `console-log-check` | File edited (`*.js`, `*.ts`, `*.tsx`) | `askAgent` | Checks for console.log statements to prevent debug code from being committed. |
| `tdd-reminder` | File created (`*.ts`, `*.tsx`) | `askAgent` | Reminds you to write tests first when creating new TypeScript files. |
| `git-push-review` | Before shell command | `askAgent` | Reviews git push commands to ensure code quality before pushing. |
| `code-review-on-write` | After write operation | `askAgent` | Triggers code review after file modifications. |
| `auto-format` | File edited (`*.ts`, `*.tsx`, `*.js`) | `askAgent` | Checks for formatting issues and fixes them inline without spawning a terminal. |
| `extract-patterns` | Agent stops | `askAgent` | Suggests patterns to add to lessons-learned.md after completing work. |
| `session-summary` | Agent stops | `askAgent` | Provides a summary of work completed in the session. |
| `doc-file-warning` | Before write operation | `askAgent` | Warns before modifying documentation files to ensure intentional changes. |
| `rust-check-on-edit` | File edited (`*.rs`) | `askAgent` | Checks for compilation errors, ownership issues, or lifetime problems in Rust files. |
| `python-lint-on-edit` | File edited (`*.py`) | `askAgent` | Checks for type errors, PEP 8 violations, or common anti-patterns in Python files. |
| `security-check-on-create` | File created (`**/auth/**`, `**/api/**`, `**/middleware/**`) | `askAgent` | Runs a quick security check when new files are created in sensitive directories. |

**IDE Hook Format:**

```json
{
  "version": "1.0.0",
  "enabled": true,
  "name": "hook-name",
  "description": "What this hook does",
  "when": {
    "type": "fileEdited",
    "patterns": ["*.ts"]
  },
  "then": {
    "type": "runCommand",
    "command": "npx tsc --noEmit"
  }
}
```

**Required fields:** `version`, `enabled`, `name`, `description`, `when`, `then`

**Available trigger types:** `fileEdited`, `fileCreated`, `fileDeleted`, `userTriggered`, `promptSubmit`, `agentStop`, `preToolUse`, `postToolUse`

#### CLI Hooks (Embedded in Agents)

CLI hooks are embedded within agent configuration files for use with `kiro-cli`.

**Example:** See `.kiro/agents/tdd-guide-with-hooks.json` for an agent with embedded hooks.

**CLI Hook Format:**

```json
{
  "name": "my-agent",
  "hooks": {
    "postToolUse": [
      {
        "matcher": "fs_write",
        "command": "npx tsc --noEmit"
      }
    ]
  }
}
```

**Available triggers:** `agentSpawn`, `userPromptSubmit`, `preToolUse`, `postToolUse`, `stop`

See `.kiro/hooks/README.md` for complete documentation on both hook types.

### Scripts

Shell scripts used by hooks to perform quality checks and formatting.

| Script | Description |
|--------|-------------|
| `quality-gate.sh` | Detects your package manager (pnpm/yarn/bun/npm) and runs build, type check, lint, and test commands. Skips checks gracefully if tools are missing. |
| `format.sh` | Detects your formatter (biome or prettier) and auto-formats the specified file. Used by formatting hooks. |

## Project Structure

```
.kiro/
├── agents/                       # 33 agents (JSON + MD formats)
│   ├── planner.json / .md        # Planning specialist
│   ├── code-reviewer.json / .md  # Code review specialist
│   ├── tdd-guide.json / .md      # TDD specialist
│   ├── security-reviewer.json / .md # Security specialist
│   ├── architect.json / .md      # Architecture specialist
│   ├── build-error-resolver.json / .md # Build error specialist
│   ├── typescript-reviewer.json / .md  # TypeScript/JS reviewer
│   ├── rust-reviewer.json / .md  # Rust reviewer
│   ├── kotlin-reviewer.json / .md # Kotlin/Android reviewer
│   ├── java-reviewer.json / .md  # Java/Spring Boot reviewer
│   ├── cpp-reviewer.json / .md   # C++ reviewer
│   ├── django-reviewer.json / .md # Django reviewer
│   ├── swift-reviewer.json / .md # Swift reviewer
│   ├── react-reviewer.json / .md # React reviewer
│   ├── mle-reviewer.json / .md   # ML engineering reviewer
│   ├── performance-optimizer.json / .md # Performance specialist
│   ├── ... and 17 more           # (build-resolvers, go, python, db, e2e, etc.)
│   └── (each agent has both .json for CLI and .md for IDE)
├── skills/                       # 43 skills
│   ├── tdd-workflow/             # TDD workflow
│   ├── coding-standards/         # Universal coding standards
│   ├── security-review/          # Security checklist
│   ├── verification-loop/        # Build/test/lint verification
│   ├── api-design/               # REST API patterns
│   ├── frontend-patterns/        # React/Next.js patterns
│   ├── backend-patterns/         # Node.js/Express patterns
│   ├── react-patterns/           # React 18/19 patterns
│   ├── react-testing/            # React Testing Library
│   ├── rust-patterns/            # Rust idioms and ownership
│   ├── kotlin-patterns/          # Kotlin coroutines and KMP
│   ├── springboot-patterns/      # Spring Boot architecture
│   ├── django-patterns/          # Django ORM and DRF
│   ├── fastapi-patterns/         # FastAPI async APIs
│   ├── nestjs-patterns/          # NestJS modules and DI
│   ├── mle-workflow/             # ML engineering workflow
│   ├── pytorch-patterns/         # PyTorch training pipelines
│   ├── ... and 26 more           # (testing, deployment, docker, etc.)
│   └── (each skill has a SKILL.md with YAML frontmatter)
├── steering/                     # 22 steering files
│   ├── coding-style.md           # Auto-loaded coding style rules
│   ├── security.md               # Auto-loaded security rules
│   ├── testing.md                # Auto-loaded testing rules
│   ├── development-workflow.md   # Auto-loaded dev workflow
│   ├── git-workflow.md           # Auto-loaded git workflow
│   ├── patterns.md               # Auto-loaded design patterns
│   ├── performance.md            # Auto-loaded performance rules
│   ├── lessons-learned.md        # Auto-loaded project patterns
│   ├── typescript-patterns.md    # Loaded for .ts/.tsx files
│   ├── typescript-security.md    # Loaded for .ts/.tsx files
│   ├── python-patterns.md        # Loaded for .py files
│   ├── golang-patterns.md        # Loaded for .go files
│   ├── swift-patterns.md         # Loaded for .swift files
│   ├── rust-patterns.md          # Loaded for .rs files
│   ├── kotlin-patterns.md        # Loaded for .kt files
│   ├── java-patterns.md          # Loaded for .java files
│   ├── cpp-patterns.md           # Loaded for .cpp/.hpp/.h files
│   ├── php-patterns.md           # Loaded for .php files
│   ├── ruby-patterns.md          # Loaded for .rb files
│   ├── dev-mode.md               # Manual: #dev-mode
│   ├── review-mode.md            # Manual: #review-mode
│   └── research-mode.md          # Manual: #research-mode
├── hooks/                        # 13 IDE hooks
│   ├── README.md                      # Documentation on IDE and CLI hooks
│   ├── quality-gate.kiro.hook         # Manual quality gate hook
│   ├── typecheck-on-edit.kiro.hook    # Auto typecheck on edit
│   ├── console-log-check.kiro.hook    # Check for console.log
│   ├── tdd-reminder.kiro.hook         # TDD reminder on file create
│   ├── git-push-review.kiro.hook      # Review before git push
│   ├── code-review-on-write.kiro.hook # Review after write
│   ├── auto-format.kiro.hook          # Auto-format on edit
│   ├── extract-patterns.kiro.hook     # Extract patterns on stop
│   ├── session-summary.kiro.hook      # Summary on stop
│   ├── doc-file-warning.kiro.hook     # Warn before doc changes
│   ├── rust-check-on-edit.kiro.hook   # Rust compilation check
│   ├── python-lint-on-edit.kiro.hook  # Python lint on edit
│   └── security-check-on-create.kiro.hook # Security check on sensitive dirs
├── scripts/                      # 2 shell scripts
│   ├── quality-gate.sh           # Quality gate shell script
│   └── format.sh                 # Auto-format shell script
└── settings/                     # MCP configuration
    └── mcp.json.example          # Example MCP server configs

docs/                             # 5 documentation files
├── longform-guide.md             # Deep dive on agentic workflows
├── shortform-guide.md            # Quick reference guide
├── security-guide.md             # Security best practices
├── migration-from-ecc.md         # Migration guide from ECC
└── ECC-KIRO-INTEGRATION-PLAN.md  # Integration plan and analysis
```

## Customization

All files are yours to modify after installation. The installer never overwrites existing files, so your customizations are safe across re-installs.

- **Edit agent prompts** in `.kiro/agents/*.json` to adjust behavior or add project-specific instructions
- **Modify skill workflows** in `.kiro/skills/*/SKILL.md` to match your team's processes
- **Adjust steering rules** in `.kiro/steering/*.md` to enforce your coding standards
- **Toggle or edit hooks** in `.kiro/hooks/*.json` to automate your workflow
- **Customize scripts** in `.kiro/scripts/*.sh` to match your tooling setup

## Recommended Workflow

1. **Start with planning**: Use the `planner` agent to break down complex features
2. **Write tests first**: Invoke the `tdd-workflow` skill before implementing
3. **Review your code**: Switch to `code-reviewer` agent after writing code
4. **Check security**: Use `security-reviewer` agent for auth, API endpoints, or sensitive data handling
5. **Run quality gate**: Trigger the `quality-gate` hook before committing
6. **Verify comprehensively**: Use the `verification-loop` skill before creating PRs

The auto-loaded steering files (coding-style, security, testing) ensure consistent standards throughout your session.

## Usage Examples

### Example 1: Building a New Feature with TDD

```bash
# 1. Start with the planner agent to break down the feature
kiro-cli --agent planner
> "I need to add user authentication with JWT tokens"

# 2. Invoke the TDD workflow skill
> /tdd-workflow

# 3. Follow the TDD cycle: write tests first, then implementation
# The tdd-workflow skill will guide you through:
# - Writing unit tests for auth logic
# - Writing integration tests for API endpoints
# - Writing E2E tests for login flow

# 4. Switch to code-reviewer after implementation
> /agent swap code-reviewer
> "Review the authentication implementation"

# 5. Run security review for auth-related code
> /agent swap security-reviewer
> "Check for security vulnerabilities in the auth system"

# 6. Trigger quality gate before committing
# (In IDE: Click the quality-gate hook in Agent Hooks panel)
```

### Example 2: Code Review Workflow

```bash
# 1. Switch to code-reviewer agent
kiro-cli --agent code-reviewer

# 2. Review specific files or directories
> "Review the changes in src/api/users.ts"

# 3. Use the verification-loop skill for comprehensive checks
> /verification-loop

# 4. The verification loop will:
# - Run build and type checks
# - Run linter
# - Run all tests
# - Perform security scan
# - Review git diff
# - Iterate until all checks pass
```

### Example 3: Security-First Development

```bash
# 1. Invoke security-review skill when working on sensitive features
> /security-review

# 2. The skill provides a comprehensive checklist:
# - Input validation and sanitization
# - Authentication and authorization
# - Secret management
# - SQL injection prevention
# - XSS prevention
# - CSRF protection

# 3. Switch to security-reviewer agent for deep analysis
> /agent swap security-reviewer
> "Analyze the API endpoints for security vulnerabilities"

# 4. The security.md steering file is auto-loaded, ensuring:
# - No hardcoded secrets
# - Proper error handling
# - Secure crypto usage
# - OWASP Top 10 compliance
```

### Example 4: Language-Specific Development

```bash
# For Go projects:
kiro-cli --agent go-reviewer
> "Review the concurrency patterns in this service"
> /golang-patterns  # Invoke Go-specific patterns skill

# For Python projects:
kiro-cli --agent python-reviewer
> "Review the type hints and error handling"
> /python-patterns  # Invoke Python-specific patterns skill

# Language-specific steering files are auto-loaded:
# - golang-patterns.md loads when editing .go files
# - python-patterns.md loads when editing .py files
# - typescript-patterns.md loads when editing .ts/.tsx files
```

### Example 5: Using Hooks for Automation

```bash
# Hooks run automatically based on triggers:

# 1. typecheck-on-edit hook
# - Triggers when you save .ts or .tsx files
# - Agent checks for type errors inline, no terminal spawned

# 2. console-log-check hook
# - Triggers when you save .js, .ts, or .tsx files
# - Agent flags console.log statements and offers to remove them

# 3. tdd-reminder hook
# - Triggers when you create a new .ts or .tsx file
# - Reminds you to write tests first
# - Reinforces TDD discipline

# 4. extract-patterns hook
# - Runs when agent stops working
# - Suggests patterns to add to lessons-learned.md
# - Builds your team's knowledge base over time

# Toggle hooks on/off in the Agent Hooks panel (IDE)
# or disable them in the hook JSON files
```

### Example 6: Manual Context Modes

```bash
# Use manual steering files for specific contexts:

# Development mode - focused on implementation
> #dev-mode
> "Implement the user registration endpoint"

# Review mode - thorough code review
> #review-mode
> "Review all changes in the current PR"

# Research mode - exploration and learning
> #research-mode
> "Explain how the authentication system works"

# Manual steering files provide context-specific instructions
# without cluttering every conversation
```

### Example 7: Database Work

```bash
# 1. Use database-reviewer agent for schema work
kiro-cli --agent database-reviewer
> "Review the database schema for the users table"

# 2. Invoke database-migrations skill
> /database-migrations

# 3. For PostgreSQL-specific work
> /postgres-patterns
> "Optimize this query for better performance"

# 4. The database-reviewer checks:
# - Schema design and normalization
# - Index usage and performance
# - Migration safety
# - SQL injection vulnerabilities
```

### Example 8: Building and Deploying

```bash
# 1. Fix build errors with build-error-resolver
kiro-cli --agent build-error-resolver
> "Fix the TypeScript compilation errors"

# 2. Use docker-patterns skill for containerization
> /docker-patterns
> "Create a production-ready Dockerfile"

# 3. Use deployment-patterns skill for CI/CD
> /deployment-patterns
> "Set up a GitHub Actions workflow for deployment"

# 4. Run quality gate before deployment
# (Trigger quality-gate hook to run all checks)
```

### Example 9: Refactoring and Cleanup

```bash
# 1. Use refactor-cleaner agent for safe refactoring
kiro-cli --agent refactor-cleaner
> "Remove unused code and consolidate duplicate functions"

# 2. The agent will:
# - Identify dead code
# - Find duplicate implementations
# - Suggest consolidation opportunities
# - Refactor safely without breaking changes

# 3. Use verification-loop after refactoring
> /verification-loop
# Ensures all tests still pass after refactoring
```

### Example 10: Documentation Updates

```bash
# 1. Use doc-updater agent for documentation work
kiro-cli --agent doc-updater
> "Update the README with the new API endpoints"

# 2. The agent will:
# - Update codemaps in docs/CODEMAPS/
# - Update README files
# - Generate API documentation
# - Keep docs in sync with code

# 3. doc-file-warning hook prevents accidental doc changes
# - Triggers before writing to documentation files
# - Asks for confirmation
# - Prevents unintentional modifications
```

## Documentation

For more detailed information, see the `docs/` directory:

- **[Longform Guide](docs/longform-guide.md)** - Deep dive on agentic workflows and best practices
- **[Shortform Guide](docs/shortform-guide.md)** - Quick reference for common tasks
- **[Security Guide](docs/security-guide.md)** - Comprehensive security best practices



## Contributers

- Himanshu Sharma [@ihimanss](https://github.com/ihimanss)
- Sungmin Hong [@aws-hsungmin](https://github.com/aws-hsungmin)



## License

MIT — see [LICENSE](LICENSE) for details.
