# Quick Reference Guide

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ecc-kiro-public-repo.git
cd ecc-kiro-public-repo

# Install to current project
./install.sh

# Install globally to ~/.kiro/
./install.sh ~
```

## Agents

### Swap to an Agent

```
/agent swap <agent-name>
```

### Available Agents

| Agent | Model | Use For |
|-------|-------|---------|
| `planner` | Opus | Breaking down complex features into tasks |
| `code-reviewer` | Sonnet | Code quality and best practices review |
| `tdd-guide` | Sonnet | Test-driven development workflows |
| `security-reviewer` | Sonnet | Security audits and vulnerability checks |
| `architect` | Opus | System design and architecture decisions |
| `build-error-resolver` | Sonnet | Fixing build and compilation errors |
| `doc-updater` | Haiku | Updating documentation and comments |
| `refactor-cleaner` | Sonnet | Code refactoring and cleanup |
| `go-reviewer` | Sonnet | Go-specific code review |
| `python-reviewer` | Sonnet | Python-specific code review |
| `database-reviewer` | Sonnet | Database schema and query review |
| `e2e-runner` | Sonnet | End-to-end test creation and execution |
| `harness-optimizer` | Opus | Test harness optimization |
| `loop-operator` | Sonnet | Verification loop execution |
| `chief-of-staff` | Opus | Project coordination and planning |
| `go-build-resolver` | Sonnet | Go build error resolution |

## Skills

### Invoke a Skill

Type `/` in chat and select from the menu, or use:

```
#skill-name
```

### Available Skills

| Skill | Use For |
|-------|---------|
| `tdd-workflow` | Red-green-refactor TDD cycle |
| `security-review` | Comprehensive security audit |
| `verification-loop` | Continuous validation and improvement |
| `coding-standards` | Code style and standards enforcement |
| `api-design` | RESTful API design patterns |
| `frontend-patterns` | React/Vue/Angular best practices |
| `backend-patterns` | Server-side architecture patterns |
| `e2e-testing` | End-to-end testing strategies |
| `golang-patterns` | Go idioms and patterns |
| `golang-testing` | Go testing best practices |
| `python-patterns` | Python idioms and patterns |
| `python-testing` | Python testing (pytest, unittest) |
| `database-migrations` | Database schema evolution |
| `postgres-patterns` | PostgreSQL optimization |
| `docker-patterns` | Container best practices |
| `deployment-patterns` | Deployment strategies |
| `search-first` | Search-driven development |
| `agentic-engineering` | Agentic workflow patterns |

## Steering Files

### Auto-Loaded (Always Active)

- `coding-style.md` - Code organization and naming
- `development-workflow.md` - Dev process and PR workflow
- `git-workflow.md` - Commit conventions and branching
- `security.md` - Security best practices
- `testing.md` - Testing standards
- `patterns.md` - Design patterns
- `performance.md` - Performance guidelines
- `lessons-learned.md` - Project-specific patterns

### File-Match (Loaded for Specific Files)

- `typescript-patterns.md` - For `*.ts`, `*.tsx` files
- `python-patterns.md` - For `*.py` files
- `golang-patterns.md` - For `*.go` files
- `swift-patterns.md` - For `*.swift` files

### Manual (Invoke with #)

```
#dev-mode          # Development context
#review-mode       # Code review context
#research-mode     # Research and exploration context
```

## Hooks

### View Hooks

Open the Agent Hooks panel in Kiro's sidebar.

### Available Hooks

| Hook | Trigger | Action |
|------|---------|--------|
| `quality-gate` | Manual | Run full quality check (build, types, lint, tests) |
| `typecheck-on-edit` | Save `*.ts`, `*.tsx` | Run TypeScript type check |
| `console-log-check` | Save `*.js`, `*.ts`, `*.tsx` | Check for console.log statements |
| `tdd-reminder` | Create `*.ts`, `*.tsx` | Remind to write tests first |
| `git-push-review` | Before shell command | Review before git push |
| `code-review-on-write` | After file write | Review written code |
| `auto-format` | Save `*.ts`, `*.tsx`, `*.js` | Auto-format with biome/prettier |
| `extract-patterns` | Agent stops | Suggest patterns for lessons-learned |
| `session-summary` | Agent stops | Summarize session |
| `doc-file-warning` | Before file write | Warn about documentation files |

### Enable/Disable Hooks

Toggle hooks in the Agent Hooks panel or edit `.kiro/hooks/*.kiro.hook` files.

## Scripts

### Run Scripts Manually

```bash
# Full quality check
.kiro/scripts/quality-gate.sh

# Format a file
.kiro/scripts/format.sh path/to/file.ts
```

## MCP Servers

### Configure MCP Servers

1. Copy example: `cp .kiro/settings/mcp.json.example .kiro/settings/mcp.json`
2. Edit `.kiro/settings/mcp.json` with your API keys
3. Restart Kiro or reconnect servers from MCP Server view

### Available MCP Servers (Example)

- `github` - GitHub API integration
- `sequential-thinking` - Enhanced reasoning
- `memory` - Persistent memory across sessions
- `context7` - Extended context management
- `vercel` - Vercel deployment
- `railway` - Railway deployment
- `cloudflare-docs` - Cloudflare documentation

## Common Workflows

### Feature Development

```
1. /agent swap planner
   "Plan a user authentication feature"

2. /agent swap tdd-guide
   #tdd-workflow
   "Implement the authentication feature"

3. /agent swap code-reviewer
   "Review the authentication implementation"
```

### Bug Fix

```
1. /agent swap planner
   "Investigate why login fails on mobile"

2. /agent swap build-error-resolver
   "Fix the login bug"

3. /agent swap security-reviewer
   "Ensure the fix is secure"
```

### Security Audit

```
1. /agent swap security-reviewer
   #security-review
   "Audit the authentication module"

2. Review findings and fix issues

3. Update lessons-learned.md with patterns
```

### Refactoring

```
1. /agent swap architect
   "Analyze the user module architecture"

2. /agent swap refactor-cleaner
   #verification-loop
   "Refactor based on the analysis"

3. /agent swap code-reviewer
   "Review the refactored code"
```

## Tips

### Get the Most from Agents

- **Be specific about intent**: "Add user authentication with JWT" not "write some auth code"
- **Let agents plan**: Don't micromanage implementation details
- **Provide context**: Reference files with `#file:path/to/file.ts`
- **Iterate with feedback**: "The error handling needs improvement" not "rewrite everything"

### Maintain Quality

- **Enable hooks early**: Catch issues immediately
- **Use TDD workflow**: Tests document behavior and catch regressions
- **Update lessons-learned**: Capture patterns once, use forever
- **Review agent output**: Agents are powerful but not infallible

### Speed Up Development

- **Use specialized agents**: They have optimized prompts and tools
- **Chain agents**: planner → tdd-guide → code-reviewer
- **Leverage skills**: Complex workflows encoded as reusable patterns
- **Use context modes**: #dev-mode for speed, #review-mode for quality

## Troubleshooting

### Agent Not Available

```
# List available agents
/agent list

# Verify installation
ls .kiro/agents/
```

### Skill Not Appearing

```
# Verify installation
ls .kiro/skills/

# Check SKILL.md format
cat .kiro/skills/skill-name/SKILL.md
```

### Hook Not Triggering

1. Check hook is enabled in Agent Hooks panel
2. Verify file patterns match: `"patterns": ["*.ts", "*.tsx"]`
3. Check hook JSON syntax: `cat .kiro/hooks/hook-name.kiro.hook`

### Steering File Not Loading

1. Check frontmatter: `inclusion: auto` or `fileMatch` or `manual`
2. For fileMatch, verify pattern: `fileMatchPattern: "*.ts,*.tsx"`
3. For manual, invoke with: `#filename`

### Script Not Executing

```bash
# Make executable
chmod +x .kiro/scripts/*.sh

# Test manually
.kiro/scripts/quality-gate.sh
```

## Getting Help

- **Longform Guide**: `docs/longform-guide.md` - Deep dive on agentic workflows
- **Security Guide**: `docs/security-guide.md` - Security best practices
- **Migration Guide**: `docs/migration-from-ecc.md` - For Claude Code users
- **GitHub Issues**: Report bugs and request features
- **Kiro Documentation**: https://kiro.dev/docs

## Customization

### Add Your Own Agent

1. Create `.kiro/agents/my-agent.json`:
```json
{
  "name": "my-agent",
  "description": "My custom agent",
  "prompt": "You are a specialized agent for...",
  "model": "claude-sonnet-5"
}
```

2. Use with: `/agent swap my-agent`

### Add Your Own Skill

1. Create `.kiro/skills/my-skill/SKILL.md`:
```markdown
---
name: my-skill
description: My custom skill
---

# My Skill

Instructions for the agent...
```

2. Use with: `/` menu or `#my-skill`

### Add Your Own Steering File

1. Create `.kiro/steering/my-rules.md`:
```markdown
---
inclusion: auto
description: My custom rules
---

# My Rules

Rules and patterns...
```

2. Auto-loaded in every conversation

### Add Your Own Hook

1. Create `.kiro/hooks/my-hook.kiro.hook`:
```json
{
  "name": "my-hook",
  "version": "1.0.0",
  "description": "My custom hook",
  "enabled": true,
  "when": {
    "type": "fileEdited",
    "patterns": ["*.ts"]
  },
  "then": {
    "type": "runCommand",
    "command": "echo 'File edited'"
  }
}
```

2. Toggle in Agent Hooks panel
