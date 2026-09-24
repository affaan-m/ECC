---
name: configure-ecc
description: Interactive installer for Everything Claude Code — guides users through selecting and installing skills and rules to user-level or project-level directories, verifies paths, and optionally optimizes installed files.
origin: ECC
---

# Configure Everything Claude Code (ECC)

An interactive, step-by-step installation wizard for the Everything Claude Code project. Uses `AskUserQuestion` to guide users through selective installation of skills and rules, then verifies correctness and offers optimization.

## When to Activate

- User says "configure ecc", "install ecc", "setup everything claude code", or similar
- User wants to selectively install skills or rules from this project
- User wants to verify or fix an existing ECC installation
- User wants to optimize installed skills or rules for their project

## Prerequisites

This skill must be accessible to Claude Code before activation. Two ways to bootstrap:
1. **Via Plugin**: `/plugin install ecc@ecc` — the plugin loads this skill automatically
2. **Manual**: Copy only this skill to `~/.claude/skills/configure-ecc/SKILL.md`, then activate by saying "configure ecc"

---

## Step 0: Clone ECC Repository

Before any installation, clone the latest ECC source to `/tmp`:

```bash
rm -rf /tmp/everything-claude-code
git clone https://github.com/affaan-m/everything-claude-code.git /tmp/everything-claude-code
```

Set `ECC_ROOT=/tmp/everything-claude-code` as the source for all subsequent copy operations.

If the clone fails (network issues, etc.), use `AskUserQuestion` to ask the user to provide a local path to an existing ECC clone.

---

## Step 1: Choose Installation Level

Use `AskUserQuestion` to ask the user where to install:

```
Question: "Where should ECC components be installed?"
Options:
  - "User-level (~/.claude/)" — "Applies to all your Claude Code projects"
  - "Project-level (.claude/)" — "Applies only to the current project"
  - "Both" — "Common/shared items user-level, project-specific items project-level"
```

Store the choice as `INSTALL_LEVEL`. Set the target directory:
- User-level: `TARGET=~/.claude`
- Project-level: `TARGET=.claude` (relative to current project root)
- Both: `TARGET_USER=~/.claude`, `TARGET_PROJECT=.claude`

Create the target directories if they don't exist:
```bash
mkdir -p $TARGET/skills $TARGET/rules
```

---

## Step 2: Select & Install Skills

### 2a: Choose Scope (Core vs Niche)

Default to **Core (recommended for new users)** — copy `.agents/skills/*` plus `skills/search-first/` for research-first workflows. This bundle covers engineering, evals, verification, security, strategic compaction, frontend design, and Anthropic cross-functional skills (article-writing, content-engine, market-research, frontend-slides).

Use `AskUserQuestion` (single select):
```
Question: "Install core skills only, or include niche/framework packs?"
Options:
  - "Core only (recommended)" — "tdd, e2e, evals, verification, research-first, security, frontend patterns, compacting, cross-functional Anthropic skills"
  - "Core + selected niche" — "Add framework/domain-specific skills after core"
  - "Niche only" — "Skip core, install specific framework/domain skills"
Default: Core only
```

If the user chooses niche or core + niche, continue to category selection below and only include those niche skills they pick.

### 2b: Choose Skill Categories

There are 7 selectable category groups below. The detailed confirmation lists that follow cover 45 skills across 8 categories, plus 1 standalone template. Use `AskUserQuestion` with `multiSelect: true`:

```
Question: "Which skill categories do you want to install?"
Options:
  - "Framework & Language" — "Django, Laravel, Spring Boot, Quarkus, Go, Python, Java, Frontend, Backend patterns"
  - "Database" — "PostgreSQL, ClickHouse, JPA/Hibernate patterns"
  - "Workflow & Quality" — "TDD, verification, learning, security review, compaction"
  - "Research & APIs" — "Deep research, Exa search, Claude API patterns"
  - "Social & Content Distribution" — "X/Twitter API, crossposting alongside content-engine"
  - "Media Generation" — "fal.ai image/video/audio alongside VideoDB"
  - "Orchestration" — "dmux multi-agent workflows"
  - "All skills" — "Install every available skill"
```

### 2c: Confirm Individual Skills

For each selected category, print the full list of skills below and ask the user to confirm or deselect specific ones. If the list exceeds 4 items, print the list as text and use `AskUserQuestion` with an "Install all listed" option plus "Other" for the user to paste specific names.

**Category: Framework & Language (25 skills)**

| Skill | Description |
|-------|-------------|
| `backend-patterns` | Backend architecture, API design, server-side best practices for Node.js/Express/Next.js |
| `coding-standards` | Universal coding standards for TypeScript, JavaScript, React, Node.js |
| `django-patterns` | Django architecture, REST API with DRF, ORM, caching, signals, middleware |
| `django-security` | Django security: auth, CSRF, SQL injection, XSS prevention |
| `django-tdd` | Django testing with pytest-django, factory_boy, mocking, coverage |
| `django-verification` | Django verification loop: migrations, linting, tests, security scans |
| `laravel-patterns` | Laravel architecture patterns: routing, controllers, Eloquent, queues, caching |
| `laravel-security` | Laravel security: auth, policies, CSRF, mass assignment, rate limiting |
| `laravel-tdd` | Laravel testing with PHPUnit and Pest, factories, fakes, coverage |
| `laravel-verification` | Laravel verification: linting, static analysis, tests, security scans |
| `frontend-patterns` | React, Next.js, state management, performance, UI patterns |
| `frontend-slides` | Zero-dependency HTML presentations, style previews, and PPTX-to-web conversion |
| `golang-patterns` | Idiomatic Go patterns, conventions for robust Go applications |
| `golang-testing` | Go testing: table-driven tests, subtests, benchmarks, fuzzing |
| `java-coding-standards` | Java coding standards for Spring Boot and Quarkus: naming, immutability, Optional, streams, CDI |
| `python-patterns` | Pythonic idioms, PEP 8, type hints, best practices |
| `python-testing` | Python testing with pytest, TDD, fixtures, mocking, parametrization |
| `quarkus-patterns` | Quarkus architecture, Camel messaging, CDI services, Panache data access |
| `quarkus-security` | Quarkus security: JWT/OIDC, RBAC, input validation, secrets management |
| `quarkus-tdd` | Quarkus TDD with JUnit 5, Mockito, REST Assured, Camel testing |
| `quarkus-verification` | Quarkus verification: build, static analysis, tests, native compilation |
| `springboot-patterns` | Spring Boot architecture, REST API, layered services, caching, async |
| `springboot-security` | Spring Security: authn/authz, validation, CSRF, secrets, rate limiting |
| `springboot-tdd` | Spring Boot TDD with JUnit 5, Mockito, MockMvc, Testcontainers |
| `springboot-verification` | Spring Boot verification: build, static analysis, tests, security scans |

**Category: Database (3 skills)**

| Skill | Description |
|-------|-------------|
| `clickhouse-io` | ClickHouse patterns, query optimization, analytics, data engineering |
| `jpa-patterns` | JPA/Hibernate entity design, relationships, query optimization, transactions |
| `postgres-patterns` | PostgreSQL query optimization, schema design, indexing, security |

**Category: Workflow & Quality (8 skills)**

| Skill | Description |
|-------|-------------|
| `continuous-learning` | Legacy v1 Stop-hook session pattern extraction; prefer `continuous-learning-v2` for new installs |
| `continuous-learning-v2` | Instinct-based learning with confidence scoring, evolves into skills, agents, and optional legacy command shims |
| `eval-harness` | Formal evaluation framework for eval-driven development (EDD) |
| `iterative-retrieval` | Progressive context refinement for subagent context problem |
| `security-review` | Security checklist: auth, input, secrets, API, payment features |
| `strategic-compact` | Suggests manual context compaction at logical intervals |
| `tdd-workflow` | Enforces TDD with 80%+ coverage: unit, integration, E2E |
| `verification-loop` | Verification and quality loop patterns |

**Category: Business & Content (5 skills)**

| Skill | Description |
|-------|-------------|
| `article-writing` | Long-form writing in a supplied voice using notes, examples, or source docs |
| `content-engine` | Multi-platform social content, scripts, and repurposing workflows |
| `market-research` | Source-attributed market, competitor, fund, and technology research |
| `investor-materials` | Pitch decks, one-pagers, investor memos, and financial models |
| `investor-outreach` | Personalized investor cold emails, warm intros, and follow-ups |

**Category: Research & APIs (2 skills)**

| Skill | Description |
|-------|-------------|
| `deep-research` | Multi-source deep research using firecrawl and exa MCPs with cited reports |
| `exa-search` | Neural search via Exa MCP for web, code, company, and people research |

`claude-api` is an Anthropic canonical skill. Install it from [`anthropics/skills`](https://github.com/anthropics/skills) when you want the official Claude API workflow instead of an ECC-bundled copy.

**Category: Social & Content Distribution (2 skills)**

| Skill | Description |
|-------|-------------|
| `x-api` | X/Twitter API integration for posting, threads, search, and analytics |
| `crosspost` | Multi-platform content distribution with platform-native adaptation |

**Category: Media Generation (2 skills)**

| Skill | Description |
|-------|-------------|
| `fal-ai-media` | Unified AI media generation (image, video, audio) via fal.ai MCP |
| `video-editing` | AI-assisted video editing for cutting, structuring, and augmenting real footage |

**Category: Orchestration (1 skill)**

| Skill | Description |
|-------|-------------|
| `dmux-workflows` | Multi-agent orchestration using dmux for parallel agent sessions |

**Standalone**

| Skill | Description |
|-------|-------------|
| `docs/examples/project-guidelines-template.md` | Template for creating project-specific skills |

### 2d: Execute Installation

For each selected skill, copy the entire skill directory from the correct source root:

```bash
# Core skills live under .agents/skills/
cp -R "$ECC_ROOT/.agents/skills/<skill-name>" "$TARGET/skills/"

# Niche skills live under skills/
cp -R "$ECC_ROOT/skills/<skill-name>" "$TARGET/skills/"
```

When iterating over globbed source directories, never pass a trailing-slash source directly to `cp`. Use the directory path as the destination name explicitly:

```bash
cp -R "${src%/}" "$TARGET/skills/$(basename "${src%/}")"
```

Note: `continuous-learning` and `continuous-learning-v2` have extra files (config.json, hooks, scripts) — ensure the entire directory is copied, not just SKILL.md.

---

## Step 3: Select & Install Rules

Use `AskUserQuestion` with `multiSelect: true`:

```
Question: "Which rule sets do you want to install?"
Options:
  - "Common rules (Recommended)" — "Language-agnostic principles: coding style, git workflow, testing, security, etc. (8 files)"
  - "TypeScript/JavaScript" — "TS/JS patterns, hooks, testing with Playwright (5 files)"
  - "Python" — "Python patterns, pytest, black/ruff formatting (5 files)"
  - "Go" — "Go patterns, table-driven tests, gofmt/staticcheck (5 files)"
```

Execute installation:
```bash
# Common rules
cp -r $ECC_ROOT/rules/common $TARGET/rules/common

# Language-specific rules (preserve per-language directories)
cp -r $ECC_ROOT/rules/typescript $TARGET/rules/typescript   # if selected
cp -r $ECC_ROOT/rules/python $TARGET/rules/python            # if selected
cp -r $ECC_ROOT/rules/golang $TARGET/rules/golang            # if selected
```

**Important**: If the user selects any language-specific rules but NOT common rules, warn them:
> "Language-specific rules extend the common rules. Installing without common rules may result in incomplete coverage. Install common rules too?"

---

## Step 4: Post-Installation Verification

After installation, perform these automated checks:

### 4a: Verify File Existence

List all installed files and confirm they exist at the target location:
```bash
ls -la $TARGET/skills/
ls -la $TARGET/rules/
```

### 4b: Check Path References

Scan all installed `.md` files for path references:
```bash
grep -rn "~/.claude/" $TARGET/skills/ $TARGET/rules/
grep -rn "../common/" $TARGET/rules/
grep -rn "skills/" $TARGET/skills/
```

**For project-level installs**, flag any references to `~/.claude/` paths:
- If a skill references `~/.claude/settings.json` — this is usually fine (settings are always user-level)
- If a skill references `~/.claude/skills/` or `~/.claude/rules/` — this may be broken if installed only at project level
- If a skill references another skill by name — check that the referenced skill was also installed

### 4c: Check Cross-References Between Skills

Some skills reference others. Verify these dependencies:
- `django-tdd` may reference `django-patterns`
- `laravel-tdd` may reference `laravel-patterns`
- `quarkus-tdd` may reference `quarkus-patterns`
- `springboot-tdd` may reference `springboot-patterns`
- `continuous-learning-v2` references `~/.claude/homunculus/` directory
- `python-testing` may reference `python-patterns`
- `golang-testing` may reference `golang-patterns`
- `crosspost` references `content-engine` and `x-api`
- `deep-research` references `exa-search` (complementary MCP tools)
- `fal-ai-media` references `videodb` (complementary media skill)
- `x-api` references `content-engine` and `crosspost`
- Language-specific rules reference `common/` counterparts

### 4d: Report Issues

For each issue found, report:
1. **File**: The file containing the problematic reference
2. **Line**: The line number
3. **Issue**: What's wrong (e.g., "references ~/.claude/skills/python-patterns but python-patterns was not installed")
4. **Suggested fix**: What to do (e.g., "install python-patterns skill" or "update path to .claude/skills/")

---

## Step 5: Optimize Installed Files (Optional)

Use `AskUserQuestion`:

```
Question: "Would you like to optimize the installed files for your project?"
Options:
  - "Optimize skills" — "Remove irrelevant sections, adjust paths, tailor to your tech stack"
  - "Optimize rules" — "Adjust coverage targets, add project-specific patterns, customize tool configs"
  - "Optimize both" — "Full optimization of all installed files"
  - "Skip" — "Keep everything as-is"
```

### If optimizing skills:
1. Read each installed SKILL.md
2. Ask the user what their project's tech stack is (if not already known)
3. For each skill, suggest removals of irrelevant sections
4. Edit the SKILL.md files in-place at the installation target (NOT the source repo)
5. Fix any path issues found in Step 4

### If optimizing rules:
1. Read each installed rule .md file
2. Ask the user about their preferences:
   - Test coverage target (default 80%)
   - Preferred formatting tools
   - Git workflow conventions
   - Security requirements
3. Edit the rule files in-place at the installation target

**Critical**: Only modify files in the installation target (`$TARGET/`), NEVER modify files in the source ECC repository (`$ECC_ROOT/`).

---

## Step 6: Installation Summary

Clean up the cloned repository from `/tmp`:

```bash
rm -rf /tmp/everything-claude-code
```

Then print a summary report:

```
## ECC Installation Complete

### Installation Target
- Level: [user-level / project-level / both]
- Path: [target path]

### Skills Installed ([count])
- skill-1, skill-2, skill-3, ...

### Rules Installed ([count])
- common (8 files)
- typescript (5 files)
- ...

### Verification Results
- [count] issues found, [count] fixed
- [list any remaining issues]

### Optimizations Applied
- [list changes made, or "None"]
```

---

## Troubleshooting

### "Skills not being picked up by Claude Code"
- Verify the skill directory contains a `SKILL.md` file (not just loose .md files)
- For user-level: check `~/.claude/skills/<skill-name>/SKILL.md` exists
- For project-level: check `.claude/skills/<skill-name>/SKILL.md` exists

### "Rules not working"
- Rules are flat files, not in subdirectories: `$TARGET/rules/coding-style.md` (correct) vs `$TARGET/rules/common/coding-style.md` (incorrect for flat install)
- Restart Claude Code after installing rules

### "Path reference errors after project-level install"
- Some skills assume `~/.claude/` paths. Run Step 4 verification to find and fix these.
- For `continuous-learning-v2`, the `~/.claude/homunculus/` directory is always user-level — this is expected and not an error.
