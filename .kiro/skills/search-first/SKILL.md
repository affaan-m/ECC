---
name: search-first
description: >
  Research-before-coding workflow. Search for existing tools, libraries, and
  patterns before writing custom code. Systematizes the "search for existing
  solutions before implementing" approach. Use when starting new features or
  adding functionality.
metadata:
  origin: ECC
---

# /search-first — Research Before You Code

Systematizes the "search for existing solutions before implementing" workflow.

## Trigger

Use this skill when:
- Starting a new feature that likely has existing solutions
- Adding a dependency or integration
- The user asks "add X functionality" and you're about to write code
- Before creating a new utility, helper, or abstraction

## Scope and Approval Rules

Default to read-only research: inspect the repo, package metadata, docs, and public examples before recommending a dependency or integration. Do not install packages, configure MCP servers, publish artifacts, open PRs, or make external write actions from this skill unless the user has explicitly approved that action in the current task.

When a candidate requires credentials, paid services, network writes, or project-wide config changes, return a recommendation and approval checkpoint instead of applying it directly.

## Workflow

```
┌─────────────────────────────────────────────┐
│  1. NEED ANALYSIS                           │
│     Define what functionality is needed      │
│     Identify language/framework constraints  │
├─────────────────────────────────────────────┤
│  2. PARALLEL SEARCH (researcher agent)      │
│     ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│     │  npm /   │ │  MCP /   │ │  GitHub / │  │
│     │  PyPI    │ │  Skills  │ │  Web      │  │
│     └──────────┘ └──────────┘ └──────────┘  │
├─────────────────────────────────────────────┤
│  3. EVALUATE                                │
│     Score candidates (functionality, maint, │
│     community, docs, license, deps)         │
├─────────────────────────────────────────────┤
│  4. DECIDE                                  │
│     ┌─────────┐  ┌──────────┐  ┌─────────┐  │
│     │  Adopt  │  │  Extend  │  │  Build   │  │
│     │ as-is   │  │  /Wrap   │  │  Custom  │  │
│     └─────────┘  └──────────┘  └─────────┘  │
├─────────────────────────────────────────────┤
│  5. APPROVAL CHECKPOINT / IMPLEMENT         │
│     Recommend package / MCP / custom code   │
│     Apply only after explicit approval      │
└─────────────────────────────────────────────┘
```

## Decision Matrix

| Signal | Action |
|--------|--------|
| Exact match, well-maintained, MIT/Apache | **Adopt** — recommend the package and request approval before install or config changes |
| Partial match, good foundation | **Extend** — recommend the package plus a thin wrapper, then wait for approval before applying |
| Multiple weak matches | **Compose** — propose 2-3 small packages and the integration plan before installing anything |
| Nothing suitable found | **Build** — explain why custom code is warranted, then implement only within the approved task scope |

## How to Use

### Quick Mode (inline)

Before writing a utility or adding functionality, mentally run through:

0. Does this already exist in the repo? → Search through relevant modules/tests first
1. Is this a common problem? → Search npm/PyPI
2. Is there an MCP for this? → Check MCP configuration and search
3. Is there a skill for this? → Check available skills
4. Is there a GitHub implementation/template? → Run GitHub code search for maintained OSS before writing net-new code

### Full Mode (subagent)

For non-trivial functionality, delegate to a research-focused subagent:

```
Invoke subagent with prompt:
  "Research existing tools for: [DESCRIPTION]
   Language/framework: [LANG]
   Constraints: [ANY]

   Search: npm/PyPI, MCP servers, skills, GitHub
   Return: Structured comparison with recommendation"
```

## Search Shortcuts by Category

### Development Tooling
- Linting → `eslint`, `ruff`, `textlint`, `markdownlint`
- Formatting → `prettier`, `black`, `gofmt`
- Testing → `jest`, `pytest`, `go test`
- Pre-commit → `husky`, `lint-staged`, `pre-commit`

### AI/LLM Integration
- Claude SDK → Check for latest docs
- Prompt management → Check MCP servers
- Document processing → `unstructured`, `pdfplumber`, `mammoth`

### Data & APIs
- HTTP clients → `httpx` (Python), `ky`/`got` (Node)
- Validation → `zod` (TS), `pydantic` (Python)
- Database → Check for MCP servers first

### Content & Publishing
- Markdown processing → `remark`, `unified`, `markdown-it`
- Image optimization → `sharp`, `imagemin`

## Integration Points

### With planner agent
The planner should invoke researcher before Phase 1 (Architecture Review):
- Researcher identifies available tools
- Planner incorporates them into the implementation plan
- Avoids "reinventing the wheel" in the plan

### With architect agent
The architect should consult researcher for:
- Technology stack decisions
- Integration pattern discovery
- Existing reference architectures

### With iterative-retrieval skill
Combine for progressive discovery:
- Cycle 1: Broad search (npm, PyPI, MCP)
- Cycle 2: Evaluate top candidates in detail
- Cycle 3: Test compatibility with project constraints

## Examples

### Example 1: "Add dead link checking"
```
Need: Check markdown files for broken links
Search: npm "markdown dead link checker"
Found: textlint-rule-no-dead-link (score: 9/10)
Action: ADOPT — recommend `textlint-rule-no-dead-link` and ask before installing it
Result: Zero custom code if approved, battle-tested solution
```

### Example 2: "Add HTTP client wrapper"
```
Need: Resilient HTTP client with retries and timeout handling
Search: npm "http client retry", PyPI "httpx retry"
Found: got (Node) with retry plugin, httpx (Python) with built-in retry
Action: ADOPT — recommend `got`/`httpx` directly with retry config and ask before changing dependencies
Result: Zero custom code if approved, production-proven libraries
```

### Example 3: "Add config file linter"
```
Need: Validate project config files against a schema
Search: npm "config linter schema", "json schema validator cli"
Found: ajv-cli (score: 8/10)
Action: ADOPT + EXTEND — recommend `ajv-cli` plus a project-specific schema, then wait for approval before install/write
Result: 1 package + 1 schema file if approved, no custom validation logic
```

## Anti-Patterns

- **Jumping to code**: Writing a utility without checking if one exists
- **Ignoring MCP**: Not checking if an MCP server already provides the capability
- **Over-customizing**: Wrapping a library so heavily it loses its benefits
- **Dependency bloat**: Installing a massive package for one small feature

## When to Use This Skill

- Starting new features
- Adding dependencies or integrations
- Before writing utilities or helpers
- When evaluating technology choices
- Planning architecture decisions
