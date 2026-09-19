# Agent Delegation Contract

Applies to every agent at every depth (parent, child, grandchild).

## Three Rules

1. **Your final message IS the deliverable**
   - Never end with "waiting for background agents"
   - A spawned task is not a completed task
   - Orphaned results when parent's turn ends

2. **If you delegate, you own collection**
   - Wait for results
   - Integrate them into your response
   - Return a complete answer, not a hand-off

3. **Decompose only when work cannot fit in one context**
   - Do not re-delegate tasks already sized for single agent
   - Depth is an outcome, not a plan
   - Split role sub-agents only for genuinely diverse perspectives

## Observed Failure Mode

Research agents spawned children, said "waiting", and returned. All children completed but results orphaned—a parallel execution rule without completion contract produces zombie tasks.

## When to Use Parallel Execution

**Parallel when independent AND someone owns collection:**
- Agent 1: Security analysis of auth module
- Agent 2: Performance review of cache system
- Agent 3: Type checking of utilities

Then **parent integrates results** before final message—no exceptions.
