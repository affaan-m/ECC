---
description: Analyze instincts and suggest or generate evolved structures
agent: build
---

# Evolve Command

Analyze and evolve instincts in continuous-learning-v2: $ARGUMENTS

## Your Task

Run:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" evolve $ARGUMENTS
```

If `CLAUDE_PLUGIN_ROOT` is unavailable, use:

```bash
python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py evolve $ARGUMENTS
```

## Supported Args (v2.1)

- no args: analysis only
- `--generate`: also generate files under `evolved/{skills,commands,agents}`

## Behavior Notes

- Uses project + global instincts for analysis.
- Shows skill/command/agent candidates from trigger and domain clustering.
- Shows project -> global promotion candidates.
- With `--generate`, output path is:
  - project context: `~/.claude/homunculus/projects/<project-id>/evolved/`
  - global fallback: `~/.claude/homunculus/evolved/`
