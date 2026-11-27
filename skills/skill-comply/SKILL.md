---
name: skill-comply
description: Visualize whether skills, rules, and agent definitions are actually followed — auto-generates scenarios at 3 prompt strictness levels, runs agents, classifies behavioral sequences, and reports compliance rates with full tool call timelines. Use when checking whether agents actually follow the skills, rules, and definitions they were given, rather than assuming they do.
metadata:
  origin: ECC
tools: Read, Bash
---

# skill-comply: Automated Compliance Measurement

Measures whether coding agents actually follow skills, rules, or agent definitions by:
1. Auto-generating expected behavioral sequences (specs) from any .md file
2. Auto-generating scenarios with decreasing prompt strictness (supportive → neutral → competing)
3. Running `claude -p` and capturing tool call traces via stream-json
4. Classifying tool calls against spec steps using LLM (not regex)
5. Checking temporal ordering deterministically
6. Generating self-contained reports with spec, prompts, and timelines

## Supported Targets

- **Skills** (`skills/*/SKILL.md`): Workflow skills like search-first, TDD guides
- **Rules** (`rules/common/*.md`): Mandatory rules like testing.md, security.md, git-workflow.md
- **Agent definitions** (`agents/*.md`): Whether an agent gets invoked when expected (internal workflow verification not yet supported)

## When to Activate

- User runs `/skill-comply <path>`
- User asks "is this rule actually being followed?"
- After adding new rules/skills, to verify agent compliance
- Periodically as part of quality maintenance

## Usage

```bash
# Full run
uv run python -m scripts.run ~/.claude/rules/common/testing.md

# Dry run (no cost, spec + scenarios only)
uv run python -m scripts.run --dry-run ~/.claude/skills/search-first/SKILL.md

# Custom models
uv run python -m scripts.run --gen-model haiku --model sonnet <path>

# Long multi-step workflows: raise the per-scenario turn cap and timeout
uv run python -m scripts.run --max-turns 120 --timeout 2400 <path>

# Copy a directory (plans, config, sources) into every scenario sandbox
uv run python -m scripts.run --fixtures ./fixtures <path>
```

| Flag | Default | Meaning |
|---|---|---|
| `--max-turns N` | 30 | Turn cap per scenario |
| `--timeout S` | 900 | Seconds per scenario; on timeout the partial trace is still graded and a warning is logged |
| `--fixtures DIR` | none | Copied into each sandbox (links/reparse points rejected, `.git` skipped case-insensitively at any depth) |

### Sandbox

Each scenario uses a private per-user directory under the OS temporary directory. This is fixture isolation, not an ECC sandbox tier or a network/credential isolation boundary. It holds the files the scenario lists under `files:` plus any `--fixtures`, committed as a baseline. It has a local bare `origin` with `origin/HEAD` set, so push and merge steps work offline. A stub `gh` is first on `PATH`: it explicitly simulates `pr create`, `pr view`, `pr list` and `repo view` and fails on other subcommands. Reports label this boundary and any timeout; they cannot establish that a real PR, merge or hosted check succeeded. Auxiliary `.bin` and `.origin.git` directories are replaced only when they carry matching tool-owned metadata.

## Key Concept: Prompt Independence

Measures whether a skill/rule is followed even when the prompt doesn't explicitly support it.

## Report Contents

Reports are self-contained and include:
1. Expected behavioral sequence (auto-generated spec)
2. Scenario prompts (what was asked at each strictness level)
3. Compliance scores per scenario
4. Tool call timelines with LLM classification labels

### Advanced (optional)

For users familiar with hooks, reports also include hook promotion recommendations for steps with low compliance. This is informational — the main value is the compliance visibility itself.
