---
name: ecc-conventions
description: Development conventions and patterns for ECC. JavaScript project with conventional commits.
license: MIT
---

# ECC Conventions

> Generated from [affaan-m/ECC](https://github.com/affaan-m/ECC) on 2026-03-20

## Overview

This skill teaches Claude the development patterns and conventions used in ECC.

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

## Cross-harness skill contribution review workflow

For ECC skill contributions, including their related tests, catalogs, and
install surfaces, follow the canonical
[`ecc-contribution-review` skill](../../../skills/ecc-contribution-review/SKILL.md).
This version supports only `changeKind: "skill"`. Its compiler checks the
structure and consistency of supplied observations; it does not independently
verify Git state, files, CI, tests, coverage, or
referenced evidence. Treat its output as a review packet, not proof of
contribution readiness.

Start from the active ECC checkout and preserve the exact branch, base and head
identities, package lock, three install manifests, catalog generator, skill
placement policy, and checkpoint as an **Observation Envelope**. Bind the
change intent, canonical source, curated/generated classification, artifact
graph, install-manifest coverage, Claude/Codex/Cursor normalized content
identity, catalog counts, command registry, TDD phases, coverage, security
review, budgets, and conventional-commit proposal.

The controller enforces the repository's deeper invariants:

1. `skills/` is canonical for curated workflows; learned, imported, evolved,
   and other generated roots cannot silently become shipped source;
2. cross-harness copies are adaptations with one normalized content identity,
   not independent forks;
3. filesystem, documented, manifest, catalog, command-registry, and intentional
   unshipped counts must reconcile;
4. RED, GREEN, and REFACTOR evidence must be observed, behavior tests must pass,
   and all coverage dimensions must meet the 80% floor;
5. strict skill frontmatter, install manifests, harness adapters, Unicode,
   personal-path, full test, coverage, and registry gates must all be green;
6. secrets, unsafe permissions, hook escalation, supply-chain drift, prompt
   injection, breaking changes, and budget overruns fail closed; and
7. the commit remains a proposal until every gate is current and external git
   authority is separately granted.

The output is a **Context Capsule** and local **Proposal**, never a **Semantic Commit**.
The compiler returns `require_review` for structurally valid input and never
approves a contribution. The output capsule may be written to the requested
path. All generated `may*` authority is false; all seven runners are typed,
unexecuted, and separately authorized.

The capsule spans all six **PCCA** planes and carries an **Epistemic Ledger**,
evidence/counterevidence, omissions, residual uncertainty, a contradiction scan
marked **computed**, every **semantic page fault**, **Memory Metabolism**
revalidation/supersession triggers, a deterministic **semantic checksum**, and
an effect report that distinguishes generated capsule output from implementation
file changes.

```bash
mkdir -p .memory-kit
cp skills/ecc-contribution-review/templates/contribution-review-observation.json \
  .memory-kit/contribution-review-observation.json
# Fill the copied observation with current facts and evidence references first.
python3 skills/ecc-contribution-review/scripts/compile_contribution_review.py \
  .memory-kit/contribution-review-observation.json \
  --output .memory-kit/ecc-contribution-review.json
python3 -m unittest discover -s skills/ecc-contribution-review/tests -p 'test*.py'
```

See `skills/ecc-contribution-review/docs/WORKFLOW.md`,
`skills/ecc-contribution-review/docs/DESIGN.md`, and
`skills/ecc-contribution-review/references/contribution-review-contract.md` for
the local contract.
