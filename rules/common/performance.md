# Performance Optimization

## Model Selection

Use model aliases (`haiku`, `sonnet`, `opus`) in agent frontmatter and
configs, not pinned version strings — aliases track the current
generation automatically.

- **haiku**: lightweight, high-frequency work — worker agents in
  multi-agent systems, quick classification and triage
- **sonnet**: default for main development work — strong coding at
  balanced cost and latency
- **opus**: deepest reasoning — architectural decisions, complex
  debugging, research and analysis

## Thinking Depth

Current models use adaptive thinking: the model decides when and how
deeply to think. Do not use manual thinking-trigger keywords
(`ultrathink`, "think harder") — control depth with the effort setting
instead, and use Plan Mode for structured multi-step work.

## Context Window Management

Avoid the last 20% of the context window for large-scale refactoring,
multi-file feature work, and complex debugging. Single-file edits,
documentation updates, and simple fixes are less context-sensitive.

Compact at natural phase boundaries rather than waiting for
auto-compaction — see the strategic-compact skill.

## Build Troubleshooting

If a build fails, use the **build-error-resolver** agent: analyze the
errors, fix incrementally, and verify after each fix.
