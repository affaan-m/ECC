# Performance Optimization

## Model Selection

Use model aliases (`haiku`, `sonnet`, `opus`, `fable`) in agent
frontmatter and configs where possible, not pinned version strings —
aliases track the current generation automatically.

- **haiku**: lightweight, high-frequency work — worker agents in
  multi-agent systems, quick classification and triage
- **sonnet**: default for main development work — strong coding at
  balanced cost and latency
- **opus**: deep reasoning — architectural decisions, complex
  debugging, research and analysis
- **fable**: frontier tier above opus — the hardest long-horizon and
  reasoning-heavy work, when correctness matters more than cost

## Model Catalog

Current generations, for when an explicit model must be named.
Pricing is $ per MTok (input / output).

### Claude (Claude Code, Anthropic API)

| Model | Alias | Tier | Pricing | Notes |
|-------|-------|------|---------|-------|
| Claude Fable 5 | `fable` | Frontier | $10 / $50 | Most capable; thinking always on |
| Claude Opus 5 | `opus` | Flagship | $5 / $25 | Long-horizon agentic work; drop-in upgrade from Opus 4.8 |
| Claude Opus 4.8 | — | Previous flagship | $5 / $25 | Recommended fallback for Opus 5 / Fable 5 refusals |
| Claude Sonnet 5 | `sonnet` | Balanced | $3 / $15 | Near-Opus coding quality at Sonnet cost |
| Claude Sonnet 4.6 | — | Previous balanced | $3 / $15 | |
| Claude Haiku 4.5 | `haiku` | Fast/cheap | $1 / $5 | Worker agents, triage |

### OpenAI GPT-5.6 (Codex)

The global CLAUDE.md is also installed as `~/.codex/AGENTS.md`, so
Codex sessions share these guidelines. Codex model IDs go in
`~/.codex/config.toml` (`model = "gpt-5.6"` selects the default tier)
or via `codex -m <id>`. All three tiers GA since 2026-07-09.

| Model | ID | Tier | Pricing | Notes |
|-------|----|------|---------|-------|
| GPT-5.6 Sol | `gpt-5.6-sol` | Flagship | $5 / $30 | Complex, ambiguous, high-value work; supports max reasoning effort and ultra mode (subagents) |
| GPT-5.6 Terra | `gpt-5.6-terra` | Balanced | $2.50 / $15 | Everyday workhorse for coding and tool use |
| GPT-5.6 Luna | `gpt-5.6-luna` | Fast/cheap | $1 / $6 | Clear, repeatable tasks |

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
