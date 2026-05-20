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
| rust-reviewer | Rust code review | Rust projects |
| harmonyos-app-resolver | HarmonyOS app development | HarmonyOS/ArkTS projects |

## Immediate Agent Usage

No user prompt needed:
1. Complex feature requests - Use **planner** agent
2. Code just written/modified - Use **code-reviewer** agent
3. Bug fix or new feature - Use **tdd-guide** agent
4. Architectural decision - Use **architect** agent

## Parallel Task Execution

**Scope:** parallel dispatch applies to **research, review, and analysis** agents whose outputs are independent reports. It does NOT apply to **implementation** agents that write to disk — those serialize to avoid merge conflicts on shared files.

ALWAYS use parallel Task execution for independent **read-only** operations:

```markdown
# GOOD: Parallel execution (reviewers / analyzers)
Launch 3 agents in parallel:
1. Agent 1: Security analysis of auth module
2. Agent 2: Performance review of cache system
3. Agent 3: Type checking of utilities

# BAD: Sequential when unnecessary
First agent 1, then agent 2, then agent 3
```

```markdown
# BAD: Parallel implementation agents on the same codebase
Launch 2 agents in parallel:
1. Agent 1: Implement endpoint X (modifies api.php)
2. Agent 2: Implement endpoint Y (modifies api.php)
# → merge conflict on api.php

# GOOD: Serialize implementation agents, OR pre-partition the work
# so each agent touches a disjoint file set.
```

This resolves the apparent conflict with `superpowers:subagent-driven-development`'s "never dispatch multiple implementation subagents in parallel" rule — both rules are now consistent: parallel reviewers yes, parallel implementers no.

## Multi-Perspective Analysis

For complex problems, use split role sub-agents:
- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
- Redundancy checker
