---
name: instinct-status
description: Show all learned instincts with their confidence levels
command: true
---

# Instinct Status Command

Shows all learned instincts with their confidence scores, grouped by domain.

## Implementation

Run the instinct CLI using the plugin root path:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" status
```

Or if `CLAUDE_PLUGIN_ROOT` is not set (manual installation), use:

```bash
python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py status
```

## Usage

```bash
/instinct-status
/instinct-status --domain code-style
/instinct-status --low-confidence
```

## What to Do

1. Read all instinct files from `~/.claude/homunculus/instincts/personal/`
2. Read inherited instincts from `~/.claude/homunculus/instincts/inherited/`
3. Display them grouped by domain with confidence bars

## Output Format

```text
📊 Instinct Status
==================

## Code Style (4 instincts)

### prefer-functional-style
Trigger: when writing new functions
Action: Use functional patterns over classes
Confidence: ████████░░ 80%
Source: session-observation | Last updated: 2025-01-22

### use-path-aliases
Trigger: when importing modules
Action: Use @/ path aliases instead of relative imports
Confidence: ██████░░░░ 60%
Source: repo-analysis (github.com/acme/webapp)

## Testing (2 instincts)

### test-first-workflow
Trigger: when adding new functionality
Action: Write test first, then implementation
Confidence: █████████░ 90%
Source: session-observation

## Workflow (3 instincts)

### grep-before-edit
Trigger: when modifying code
Action: Search with Grep, confirm with Read, then Edit
Confidence: ███████░░░ 70%
Source: session-observation

---
Total: 9 instincts (4 personal, 5 inherited)
Observer: Running (last analysis: 5 min ago)
```

## Flags

- `--domain <name>`: Filter by domain (code-style, testing, git, etc.)
- `--low-confidence`: Show only instincts with confidence < 0.5
- `--high-confidence`: Show only instincts with confidence >= 0.7
- `--source <type>`: Filter by source (session-observation, repo-analysis, inherited)
- `--json`: Output as JSON for programmatic use
