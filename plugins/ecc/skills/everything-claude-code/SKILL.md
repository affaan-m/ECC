---
name: everything-claude-code
description: Development conventions and patterns for everything-claude-code. JavaScript project with conventional commits.
---

# Everything Claude Code Conventions

> Generated from [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code) on 2026-03-20

## Overview

This skill teaches Claude the development patterns and conventions used in everything-claude-code.

## Tech Stack

- **Primary Language**: JavaScript
- **Architecture**: hybrid module organization
- **Test Location**: separate

## When to Use This Skill

Activate this skill when:
- Making changes to this repository
- Adding new features following established patterns
- Writing tests that match project conventions
- Creating commits with proper message format

## Commit Conventions

Follow these commit message conventions based on 500 analyzed commits.

### Commit Style: Conventional Commits

### Prefixes Used

- `fix`
- `test`
- `feat`
- `docs`

### Message Guidelines

- Average message length: ~65 characters
- Keep first line concise and descriptive
- Use imperative mood ("Add feature" not "Added feature")


*Commit message example*

```text
feat(rules): add C# language support
```

*Commit message example*

```text
chore(deps-dev): bump flatted (#675)
```

*Commit message example*

```text
fix: auto-detect ECC root from plugin cache when CLAUDE_PLUGIN_ROOT is unset (#547) (#691)
```

*Commit message example*

```text
docs: add Antigravity setup and usage guide (#552)
```

*Commit message example*

```text
merge: PR #529 — feat(skills): add documentation-lookup, bun-runtime, nextjs-turbopack; feat(agents): add rust-reviewer
```

*Commit message example*

```text
Revert "Add Kiro IDE support (.kiro/) (#548)"
```

*Commit message example*

```text
Add Kiro IDE support (.kiro/) (#548)
```

*Commit message example*

```text
feat: add block-no-verify hook for Claude Code and Cursor (#649)
```

## Architecture

### Project Structure: Single Package

This project uses **hybrid** module organization.

### Configuration Files

- `.github/workflows/ci.yml`
- `.github/workflows/maintenance.yml`
- `.github/workflows/monthly-metrics.yml`
- `.github/workflows/release.yml`
- `.github/workflows/reusable-release.yml`
- `.github/workflows/reusable-test.yml`
- `.github/workflows/reusable-validate.yml`
- `.opencode/package.json`
- `.opencode/tsconfig.json`
- `.prettierrc`
- `eslint.config.js`
- `package.json`

### Guidelines

- This project uses a hybrid organization
- Follow existing patterns when adding new code

## Code Style

### Language: JavaScript

### Naming Conventions

| Element | Convention |
|---------|------------|
| Files | camelCase |
| Functions | camelCase |
| Classes | PascalCase |
| Constants | SCREAMING_SNAKE_CASE |

### Import Style: Relative Imports

### Export Style: Mixed Style


*Preferred import style*

```typescript
// Use relative imports
import { Button } from '../components/Button'
import { useAuth } from './hooks/useAuth'
```

## Testing

### Test Framework

No specific test framework detected — use the repository's existing test patterns.

### File Pattern: `*.test.js`

### Test Types

- **Unit tests**: Test individual functions and components in isolation
- **Integration tests**: Test interactions between multiple components/services

### Coverage

This project has coverage reporting configured. Aim for 80%+ coverage.


## Error Handling

### Error Handling Style: Try-Catch Blocks


*Standard error handling pattern*

```typescript
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  console.error('Operation failed:', error)
  throw new Error('User-friendly message')
}
```

## Common Workflows

These workflows were detected from analyzing commit patterns.

### Database Migration

Database schema changes with migration files

**Frequency**: ~2 times per month

**Steps**:
1. Create migration file
2. Update schema definitions
3. Generate/update types

**Files typically involved**:
- `**/schema.*`
- `migrations/*`

**Example commit sequence**:
```
feat: implement --with/--without selective install flags (#679)
fix: sync catalog counts with filesystem (27 agents, 113 skills, 58 commands) (#693)
feat(rules): add Rust language rules (rebased #660) (#686)
```

### Feature Development

Standard feature implementation workflow

**Frequency**: ~22 times per month

**Steps**:
1. Add feature implementation
2. Add tests for feature
3. Update documentation

**Files typically involved**:
- `manifests/*`
- `schemas/*`
- `**/*.test.*`
- `**/api/**`

**Example commit sequence**:
```
feat(skills): add documentation-lookup, bun-runtime, nextjs-turbopack; feat(agents): add rust-reviewer
docs(skills): align documentation-lookup with CONTRIBUTING template; add cross-harness (Codex/Cursor) skill copies
fix: address PR review — skill template (When to use, How it works, Examples), bun.lock, next build note, rust-reviewer CI note, doc-lookup privacy/uncertainty
```

### Add Language Rules

Adds a new programming language to the rules system, including coding style, hooks, patterns, security, and testing guidelines.

**Frequency**: ~2 times per month

**Steps**:
1. Create a new directory under rules/{language}/
2. Add coding-style.md, hooks.md, patterns.md, security.md, and testing.md files with language-specific content
3. Optionally reference or link to related skills

**Files typically involved**:
- `rules/*/coding-style.md`
- `rules/*/hooks.md`
- `rules/*/patterns.md`
- `rules/*/security.md`
- `rules/*/testing.md`

**Example commit sequence**:
```
Create a new directory under rules/{language}/
Add coding-style.md, hooks.md, patterns.md, security.md, and testing.md files with language-specific content
Optionally reference or link to related skills
```

### Add New Skill

Adds a new skill to the system, documenting its workflow, triggers, and usage, often with supporting scripts.

**Frequency**: ~4 times per month

**Steps**:
1. Create a new directory under skills/{skill-name}/
2. Add SKILL.md with documentation (When to Use, How It Works, Examples, etc.)
3. Optionally add scripts or supporting files under skills/{skill-name}/scripts/
4. Address review feedback and iterate on documentation

**Files typically involved**:
- `skills/*/SKILL.md`
- `skills/*/scripts/*.sh`
- `skills/*/scripts/*.js`

**Example commit sequence**:
```
Create a new directory under skills/{skill-name}/
Add SKILL.md with documentation (When to Use, How It Works, Examples, etc.)
Optionally add scripts or supporting files under skills/{skill-name}/scripts/
Address review feedback and iterate on documentation
```

### Add New Agent

Adds a new agent to the system for code review, build resolution, or other automated tasks.

**Frequency**: ~2 times per month

**Steps**:
1. Create a new agent markdown file under agents/{agent-name}.md
2. Register the agent in AGENTS.md
3. Optionally update README.md and docs/COMMAND-AGENT-MAP.md

**Files typically involved**:
- `agents/*.md`
- `AGENTS.md`
- `README.md`
- `docs/COMMAND-AGENT-MAP.md`

**Example commit sequence**:
```
Create a new agent markdown file under agents/{agent-name}.md
Register the agent in AGENTS.md
Optionally update README.md and docs/COMMAND-AGENT-MAP.md
```

### Add New Workflow Surface

Adds or updates a workflow entrypoint. Default to skills-first; only add a command shim when legacy slash compatibility is still required.

**Frequency**: ~1 times per month

**Steps**:
1. Create or update the canonical workflow under skills/{skill-name}/SKILL.md
2. Only if needed, add or update commands/{command-name}.md as a compatibility shim

**Files typically involved**:
- `skills/*/SKILL.md`
- `commands/*.md` (only when a legacy shim is intentionally retained)

**Example commit sequence**:
```
Create or update the canonical skill under skills/{skill-name}/SKILL.md
Only if needed, add or update commands/{command-name}.md as a compatibility shim
```

### Sync Catalog Counts

Synchronizes the documented counts of agents, skills, and commands in AGENTS.md and README.md with the actual repository state.

**Frequency**: ~3 times per month

**Steps**:
1. Update agent, skill, and command counts in AGENTS.md
2. Update the same counts in README.md (quick-start, comparison table, etc.)
3. Optionally update other documentation files

**Files typically involved**:
- `AGENTS.md`
- `README.md`

**Example commit sequence**:
```
Update agent, skill, and command counts in AGENTS.md
Update the same counts in README.md (quick-start, comparison table, etc.)
Optionally update other documentation files
```

### Add Cross Harness Skill Copies

Adds skill copies for different agent harnesses (e.g., Codex, Cursor, Antigravity) to ensure compatibility across platforms.

**Frequency**: ~2 times per month

**Steps**:
1. Copy or adapt SKILL.md to .agents/skills/{skill}/SKILL.md and/or .cursor/skills/{skill}/SKILL.md
2. Optionally add harness-specific openai.yaml or config files
3. Address review feedback to align with CONTRIBUTING template

**Files typically involved**:
- `.agents/skills/*/SKILL.md`
- `.cursor/skills/*/SKILL.md`
- `.agents/skills/*/agents/openai.yaml`

**Example commit sequence**:
```
Copy or adapt SKILL.md to .agents/skills/{skill}/SKILL.md and/or .cursor/skills/{skill}/SKILL.md
Optionally add harness-specific openai.yaml or config files
Address review feedback to align with CONTRIBUTING template
```

### Add Or Update Hook

Adds or updates git or bash hooks to enforce workflow, quality, or security policies.

**Frequency**: ~1 times per month

**Steps**:
1. Add or update hook scripts in hooks/ or scripts/hooks/
2. Register the hook in hooks/hooks.json or similar config
3. Optionally add or update tests in tests/hooks/

**Files typically involved**:
- `hooks/*.hook`
- `hooks/hooks.json`
- `scripts/hooks/*.js`
- `tests/hooks/*.test.js`
- `.cursor/hooks.json`

**Example commit sequence**:
```
Add or update hook scripts in hooks/ or scripts/hooks/
Register the hook in hooks/hooks.json or similar config
Optionally add or update tests in tests/hooks/
```

### Address Review Feedback

Addresses code review feedback by updating documentation, scripts, or configuration for clarity, correctness, or convention alignment.

**Frequency**: ~4 times per month

**Steps**:
1. Edit SKILL.md, agent, or command files to address reviewer comments
2. Update examples, headings, or configuration as requested
3. Iterate until all review feedback is resolved

**Files typically involved**:
- `skills/*/SKILL.md`
- `agents/*.md`
- `commands/*.md`
- `.agents/skills/*/SKILL.md`
- `.cursor/skills/*/SKILL.md`

**Example commit sequence**:
```
Edit SKILL.md, agent, or command files to address reviewer comments
Update examples, headings, or configuration as requested
Iterate until all review feedback is resolved
```


## Best Practices

Based on analysis of the codebase, follow these practices:

### Do

- Use conventional commit format (feat:, fix:, etc.)
- Follow *.test.js naming pattern
- Use camelCase for file names
- Prefer mixed exports

### Don't

- Don't write vague commit messages
- Don't skip tests for new features
- Don't deviate from established patterns without discussion

---

*This skill was auto-generated by [ECC Tools](https://ecc.tools). Review and customize as needed for your team.*
