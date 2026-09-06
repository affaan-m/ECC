# Skill Development Guide

A comprehensive guide to creating effective skills for Everything Claude Code (ECC).

## Table of Contents

- [What Are Skills?](#what-are-skills)
- [Skill Architecture](#skill-architecture)
- [Creating Your First Skill](#creating-your-first-skill)
- [Skill Categories](#skill-categories)
- [Writing Effective Skill Content](#writing-effective-skill-content)
- [Best Practices](#best-practices)
- [Common Patterns](#common-patterns)
- [Testing Your Skill](#testing-your-skill)
- [Submitting Your Skill](#submitting-your-skill)
- [Examples Gallery](#examples-gallery)

---

## What Are Skills?

Skills are **knowledge modules** that Claude Code loads based on context. They provide:

- **Domain expertise**: Framework patterns, language idioms, best practices
- **Workflow definitions**: Step-by-step processes for common tasks
- **Reference material**: Code snippets, checklists, decision trees
- **Context injection**: Activate when specific conditions are met

Unlike **agents** (specialized subassistants) or **commands** (user-triggered actions), skills are passive knowledge that Claude Code references when relevant.

### When Skills Activate

Skills activate when:
- The user's task matches the skill's domain
- Claude Code detects relevant context
- A command references a skill
- An agent needs domain knowledge

### Skill vs Agent vs Command

| Component | Purpose | Activation |
|-----------|---------|------------|
| **Skill** | Knowledge repository | Context-based (automatic) |
| **Agent** | Task executor | Explicit delegation |
| **Command** | User action | User-invoked (`/command`) |
| **Hook** | Automation | Event-triggered |
| **Rule** | Always-on guidelines | Always active |

---

## Skill Architecture

### File Structure

```
skills/
└── your-skill-name/
    ├── SKILL.md           # Required: Main skill definition
    ├── examples/          # Optional: Code examples
    │   ├── basic.ts
    │   └── advanced.ts
    └── references/        # Optional: External references
        └── links.md
```

### SKILL.md Format

```markdown
---
name: skill-name
description: Brief description shown in skill list and used for auto-activation
origin: ECC
---

# Skill Title

Brief overview of what this skill covers.

## When to Activate

Describe scenarios where Claude should use this skill.

## Core Concepts

Main patterns and guidelines.

## Code Examples

\`\`\`typescript
// Practical, tested examples
\`\`\`

## Anti-Patterns

Show what NOT to do with concrete examples.

## Best Practices

- Actionable guidelines
- Do's and don'ts

## Related Skills

Link to complementary skills.
```

### YAML Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Lowercase, hyphenated identifier (e.g., `react-patterns`) |
| `description` | Yes | One-line description for skill list and auto-activation |
| `origin` | No | Source identifier (e.g., `ECC`, `community`, project name) |
| `tags` | No | Array of tags for categorization |
| `version` | No | Skill version for tracking updates |

---

## Creating Your First Skill

### Step 1: Choose a Focus

Good skills are **focused and actionable**:

| PASS: Good Focus | FAIL: Too Broad |
|---------------|--------------|
| `react-hook-patterns` | `react` |
| `postgresql-indexing` | `databases` |
| `pytest-fixtures` | `python-testing` |
| `nextjs-app-router` | `nextjs` |

### Step 2: Create the Directory

```bash
mkdir -p skills/your-skill-name
```

### Step 3: Write SKILL.md

Here's a minimal template:

```markdown
---
name: your-skill-name
description: Brief description of when to use this skill
---

# Your Skill Title

Brief overview (1-2 sentences).

## When to Activate

- Scenario 1
- Scenario 2
- Scenario 3

## Core Concepts

### Concept 1

Explanation with examples.

### Concept 2

Another pattern with code.

## Code Examples

\`\`\`typescript
// Practical example
\`\`\`

## Best Practices

- Do this
- Avoid that

## Related Skills

- `related-skill-1`
- `related-skill-2`
```

### Step 4: Add Content

Write content that Claude can **immediately use**:

- PASS: Copy-pasteable code examples
- PASS: Clear decision trees
- PASS: Checklists for verification
- FAIL: Vague explanations without examples
- FAIL: Long prose without actionable guidance

---

## Skill Categories

### Language Standards

Focus on idiomatic code, naming conventions, and language-specific patterns.

**Examples:** `python-patterns`, `golang-patterns`, `typescript-standards`

```markdown
---
name: python-patterns
description: Python idioms, best practices, and patterns for clean, idiomatic code.
---

# Python Patterns

## When to Activate

- Writing Python code
- Refactoring Python modules
- Python code review

## Core Concepts

### Context Managers

\`\`\`python
# Always use context managers for resources
with open('file.txt') as f:
    content = f.read()
\`\`\`
```

### Framework Patterns

Focus on framework-specific conventions, common patterns, and anti-patterns.

**Examples:** `django-patterns`, `nextjs-patterns`, `springboot-patterns`

```markdown
---
name: django-patterns
description: Django best practices for models, views, URLs, and templates.
---

# Django Patterns

## When to Activate

- Building Django applications
- Creating models and views
- Django URL configuration
```

### Workflow Skills

Define step-by-step processes for common development tasks.

**Examples:** `tdd-workflow`, `code-review-workflow`, `deployment-checklist`

```markdown
---
name: code-review-workflow
description: Systematic code review process for quality and security.
---

# Code Review Workflow

## Steps

1. **Understand Context** - Read PR description and linked issues
2. **Check Tests** - Verify test coverage and quality
3. **Review Logic** - Analyze implementation for correctness
4. **Check Security** - Look for vulnerabilities
5. **Verify Style** - Ensure code follows conventions
```

### Domain Knowledge

Specialized knowledge for specific domains (security, performance, etc.).

**Examples:** `security-review`, `performance-optimization`, `api-design`

```markdown
---
name: api-design
description: REST and GraphQL API design patterns, versioning, and best practices.
---

# API Design Patterns

## RESTful Conventions

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /resources | List all |
| GET | /resources/:id | Get one |
| POST | /resources | Create |
```

### Tool Integration

Guidance for using specific tools, libraries, or services.

**Examples:** `supabase-patterns`, `docker-patterns`, `mcp-server-patterns`

---

## Writing Effective Skill Content

### 1. Start with "When to Activate"

This section is **critical** for auto-activation. Be specific:

```markdown
## When to Activate

- Creating new React components
- Refactoring existing components
- Debugging React state issues
- Reviewing React code for best practices
```

### 2. Use "Show, Don't Tell"

Bad:
```markdown
## Error Handling

Always handle errors properly in async functions.
```

Good:
```markdown
## Error Handling

\`\`\`typescript
async function fetchData(url: string) {
  try {
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(\`HTTP \${response.status}: \${response.statusText}\`)
    }

    return await response.json()
  } catch (error) {
    console.error('Fetch failed:', error)
    throw new Error('Failed to fetch data')
  }
}
\`\`\`

### Key Points

- Check \`response.ok\` before parsing
- Log errors for debugging
- Re-throw with user-friendly message
```

### 3. Include Anti-Patterns

Show what NOT to do:

```markdown
## Anti-Patterns

### FAIL: Direct State Mutation

\`\`\`typescript
// NEVER do this
user.name = 'New Name'
items.push(newItem)
\`\`\`

### PASS: Immutable Updates

\`\`\`typescript
// ALWAYS do this
const updatedUser = { ...user, name: 'New Name' }
const updatedItems = [...items, newItem]
\`\`\`
```

### 4. Provide Checklists

Checklists are actionable and easy to follow:

```markdown
## Pre-Deployment Checklist

- [ ] All tests passing
- [ ] No console.log in production code
- [ ] Environment variables documented
- [ ] Secrets not hardcoded
- [ ] Error handling complete
- [ ] Input validation in place
```

### 5. Use Decision Trees

For complex decisions:

```markdown
## Choosing the Right Approach

\`\`\`
Need to fetch data?
├── Single request → use fetch directly
├── Multiple independent → Promise.all()
├── Multiple dependent → await sequentially
└── With caching → use SWR or React Query
\`\`\`
```

---

## Best Practices

### DO

| Practice | Example |
|----------|---------|
| **Be specific** | "Use \`useCallback\` for event handlers passed to child components" |
| **Show examples** | Include copy-pasteable code |
| **Explain WHY** | "Immutability prevents unexpected side effects in React state" |
| **Link related skills** | "See also: \`react-performance\`" |
| **Keep focused** | One skill = one domain/concept |
| **Use sections** | Clear headers for easy scanning |

### DON'T

| Practice | Why It's Bad |
|----------|--------------|
| **Be vague** | "Write good code" - not actionable |
| **Long prose** | Hard to parse, better as code |
| **Cover too much** | "Python, Django, and Flask patterns" - too broad |
| **Skip examples** | Theory without practice is less useful |
| **Ignore anti-patterns** | Learning what NOT to do is valuable |

### Content Guidelines

1. **Length**: 200-500 lines typical, 800 lines maximum
2. **Code blocks**: Include language identifier
3. **Headers**: Use `##` and `###` hierarchy
4. **Lists**: Use `-` for unordered, `1.` for ordered
5. **Tables**: For comparisons and references

---

## Common Patterns

### Pattern 1: Standards Skill

```markdown
---
name: language-standards
description: Coding standards and best practices for [language].
---

# [Language] Coding Standards

## When to Activate

- Writing [language] code
- Code review
- Setting up linting

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Variables | camelCase | userName |
| Constants | SCREAMING_SNAKE | MAX_RETRY |
| Functions | camelCase | fetchUser |
| Classes | PascalCase | UserService |

## Code Examples

[Include practical examples]

## Linting Setup

[Include configuration]

## Related Skills

- `language-testing`
- `language-security`
```

### Pattern 2: Workflow Skill

```markdown
---
name: task-workflow
description: Step-by-step workflow for [task].
---

# [Task] Workflow

## When to Activate

- [Trigger 1]
- [Trigger 2]

## Prerequisites

- [Requirement 1]
- [Requirement 2]

## Steps

### Step 1: [Name]

[Description]

\`\`\`bash
[Commands]
\`\`\`

### Step 2: [Name]

[Description]

## Verification

- [ ] [Check 1]
- [ ] [Check 2]

## Troubleshooting

| Problem | Solution |
|---------|----------|
| [Issue] | [Fix] |
```

### Pattern 3: Reference Skill

```markdown
---
name: api-reference
description: Quick reference for [API/Library].
---

# [API/Library] Reference

## When to Activate

- Using [API/Library]
- Looking up [API/Library] syntax

## Common Operations

### Operation 1

\`\`\`typescript
// Basic usage
\`\`\`

### Operation 2

\`\`\`typescript
// Advanced usage
\`\`\`

## Configuration

[Include config examples]

## Error Handling

[Include error patterns]
```

---

## Testing Your Skill

### Local Testing

1. **Copy to Claude Code skills directory**:
   ```bash
   cp -r skills/your-skill-name ~/.claude/skills/
   ```

2. **Test with Claude Code**:
   ```
   You: "I need to [task that should trigger your skill]"

   Claude should reference your skill's patterns.
   ```

3. **Verify activation**:
   - Ask Claude to explain a concept from your skill
   - Check if it uses your examples and patterns
   - Ensure it follows your guidelines

### Validation Checklist

- [ ] **YAML frontmatter valid** - No syntax errors
- [ ] **Name follows convention** - lowercase-with-hyphens
- [ ] **Description is clear** - Tells when to use
- [ ] **Examples work** - Code compiles and runs
- [ ] **Links valid** - Related skills exist
- [ ] **No sensitive data** - No API keys, tokens, paths

### Code Example Testing

Test all code examples:

```bash
# From the repo root
npx tsc --noEmit skills/your-skill-name/examples/*.ts

# Or from inside the skill directory
npx tsc --noEmit examples/*.ts

# From the repo root
python -m py_compile skills/your-skill-name/examples/*.py

# Or from inside the skill directory
python -m py_compile examples/*.py

# From the repo root
go build ./skills/your-skill-name/examples/...

# Or from inside the skill directory
go build ./examples/...
```

---

## Submitting Your Skill

### 1. Fork and Clone

```bash
gh repo fork affaan-m/everything-claude-code --clone
cd everything-claude-code
```

### 2. Create Branch

```bash
git checkout -b feat/skill-your-skill-name
```

### 3. Add Your Skill

```bash
mkdir -p skills/your-skill-name
# Create SKILL.md
```

### 4. Validate

```bash
# Check YAML frontmatter
head -10 skills/your-skill-name/SKILL.md

# Verify structure
ls -la skills/your-skill-name/

# Run tests if available
npm test
```

### 5. Commit and Push

```bash
git add skills/your-skill-name/
git commit -m "feat(skills): add your-skill-name skill"
git push -u origin feat/skill-your-skill-name
```

### 6. Create Pull Request

Use this PR template:

```markdown
## Summary

Brief description of the skill and why it's valuable.

## Skill Type

- [ ] Language standards
- [ ] Framework patterns
- [ ] Workflow
- [ ] Domain knowledge
- [ ] Tool integration

## Testing

How I tested this skill locally.

## Checklist

- [ ] YAML frontmatter valid
- [ ] Code examples tested
- [ ] Follows skill guidelines
- [ ] No sensitive data
- [ ] Clear activation triggers
```

---

## Examples Gallery

### Example 1: Language Standards

**File:** `skills/rust-patterns/SKILL.md`

```markdown
---
name: rust-patterns
description: Rust idioms, ownership patterns, and best practices for safe, idiomatic code.
origin: ECC
---

# Rust Patterns

## When to Activate

- Writing Rust code
- Handling ownership and borrowing
- Error handling with Result/Option
- Implementing traits

## Ownership Patterns

### Borrowing Rules

\`\`\`rust
// PASS: CORRECT: Borrow when you don't need ownership
fn process_data(data: &str) -> usize {
    data.len()
}

// PASS: CORRECT: Take ownership when you need to modify or consume
fn consume_data(data: Vec<u8>) -> String {
    String::from_utf8(data).unwrap()
}
\`\`\`

## Error Handling

### Result Pattern

\`\`\`rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Parse error: {0}")]
    Parse(#[from] std::num::ParseIntError),
}

pub type AppResult<T> = Result<T, AppError>;
\`\`\`

## Related Skills

- `rust-testing`
- `rust-security`
```

### Example 2: Framework Patterns

**File:** `skills/fastapi-patterns/SKILL.md`

```markdown
---
name: fastapi-patterns
description: FastAPI patterns for routing, dependency injection, validation, and async operations.
origin: ECC
---

# FastAPI Patterns

## When to Activate

- Building FastAPI applications
- Creating API endpoints
- Implementing dependency injection
- Handling async database operations

## Project Structure

\`\`\`
app/
├── main.py              # FastAPI app entry point
├── routers/             # Route handlers
│   ├── users.py
│   └── items.py
├── models/              # Pydantic models
│   ├── user.py
│   └── item.py
├── services/            # Business logic
│   └── user_service.py
└── dependencies.py      # Shared dependencies
\`\`\`

## Dependency Injection

\`\`\`python
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session

@router.get("/users/{user_id}")
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db)
):
    # Use db session
    pass
\`\`\`

## Related Skills

- `python-patterns`
- `pydantic-validation`
```

### Example 3: Workflow Skill

**File:** `skills/refactoring-workflow/SKILL.md`

```markdown
---
name: refactoring-workflow
description: Systematic refactoring workflow for improving code quality without changing behavior.
origin: ECC
---

# Refactoring Workflow

## When to Activate

- Improving code structure
- Reducing technical debt
- Simplifying complex code
- Extracting reusable components

## Prerequisites

- All tests passing
- Git working directory clean
- Feature branch created

## Workflow Steps

### Step 1: Identify Refactoring Target

- Look for code smells (long methods, duplicate code, large classes)
- Check test coverage for target area
- Document current behavior

### Step 2: Ensure Tests Exist

\`\`\`bash
# Run tests to verify current behavior
npm test

# Check coverage for target files
npm run test:coverage
\`\`\`

### Step 3: Make Small Changes

- One refactoring at a time
- Run tests after each change
- Commit frequently

### Step 4: Verify Behavior Unchanged

\`\`\`bash
# Run full test suite
npm test

# Run E2E tests
npm run test:e2e
\`\`\`

## Common Refactorings

| Smell | Refactoring |
|-------|-------------|
| Long method | Extract method |
| Duplicate code | Extract to shared function |
| Large class | Extract class |
| Long parameter list | Introduce parameter object |

## Checklist

- [ ] Tests exist for target code
- [ ] Made small, focused changes
- [ ] Tests pass after each change
- [ ] Behavior unchanged
- [ ] Committed with clear message
```

---

## Additional Resources

- [DevScratchpad AI Skill Studio](https://www.devscratchpad.tech/ai-skill-studio/claude-skills) - Browser-based scratchpad and generator to compose, validate, and export Claude Code `SKILL.md` files and `.agents/` directives with 36+ framework presets.
- [CONTRIBUTING.md](../CONTRIBUTING.md) - General contribution guidelines
- [project-guidelines-template](./examples/project-guidelines-template.md) - Project-specific skill template
- [coding-standards](../skills/coding-standards/SKILL.md) - Example of standards skill
- [tdd-workflow](../skills/tdd-workflow/SKILL.md) - Example of workflow skill
- [security-review](../skills/security-review/SKILL.md) - Example of domain knowledge skill

---

**Remember**: A good skill is focused, actionable, and immediately useful. Write skills you'd want to use yourself.
