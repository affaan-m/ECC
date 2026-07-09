---
inclusion: auto
name: performance
description: Performance optimization guidelines including model selection strategy, context window management, and build troubleshooting
---

# Performance Optimization

## Model Selection Strategy

**Claude Haiku 4.5** (90% of Sonnet capability, 3x cost savings):
- Lightweight agents with frequent invocation
- Pair programming and code generation
- Worker agents in multi-agent systems

**Claude Sonnet 4.6** (Best coding model):
- Main development work
- Orchestrating multi-agent workflows
- Complex coding tasks

**Claude Opus 4.6** (Deepest reasoning):
- Complex architectural decisions
- Maximum reasoning requirements
- Research and analysis tasks

## Context Window Management

Avoid last 20% of context window for:
- Large-scale refactoring
- Feature implementation spanning multiple files
- Debugging complex interactions

Lower context sensitivity tasks:
- Single-file edits
- Independent utility creation
- Documentation updates
- Simple bug fixes

## Extended Thinking

Extended thinking is enabled by default in Kiro, reserving tokens for internal reasoning.

For complex tasks requiring deep reasoning:
1. Ensure extended thinking is enabled
2. Use structured approach for planning
3. Use multiple critique rounds for thorough analysis
4. Use sub-agents for diverse perspectives

## Build Troubleshooting

If build fails:
1. Use build-error-resolver agent
2. Analyze error messages
3. Fix incrementally
4. Verify after each fix
