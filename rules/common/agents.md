# Agent Orchestration

## Available Agents

Located in `~/.claude/agents/`:

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| planner | Implementation planning | Complex features, refactoring |
| architect | System design | Architectural decisions |
| tdd-guide | Test-driven development | New features, bug fixes |
| code-reviewer | Code review | After writing code |
| security-reviewer | Security analysis | Before commits |
| build-error-resolver | Fix build errors | When build fails |
| e2e-runner | E2E testing | Critical user flows |
| refactor-cleaner | Dead code cleanup | Code maintenance |
| doc-updater | Documentation | Updating docs |

## When to Delegate

Use an agent when the task genuinely benefits from a separate context:
planner or architect for sizeable features and design decisions,
code-reviewer after writing significant code, tdd-guide for new
features and bug fixes, security-reviewer for security-sensitive
changes. For work you can finish directly in a handful of tool calls,
work directly instead of delegating.

## Parallel Execution

When multiple agents are needed for independent work, launch them in
parallel in a single message rather than sequentially — e.g. security
analysis, performance review, and type checking of separate files can
run concurrently.
