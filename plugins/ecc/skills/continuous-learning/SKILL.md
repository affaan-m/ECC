---
name: continuous-learning
description: "[DEPRECATED - use continuous-learning-v2] Legacy v1 stop-hook skill extractor. v2 is a strict superset with instinct-based, project-scoped, hook-reliable learning. Do not invoke v1; route continuous learning, session learning, and pattern extraction requests to continuous-learning-v2."
origin: ECC
---

# Continuous Learning Skill - DEPRECATED

> **DEPRECATED 2026-04-28.** Use `continuous-learning-v2` instead. v2 is a strict superset: stop-hook observation becomes PreToolUse/PostToolUse observation, full skills become atomic instincts with confidence scoring, and global-only storage becomes project-scoped plus global promotion.
>
> This file is kept for archival reference and backward compatibility with existing installs.

---

## Original v1 Documentation (archival)

Automatically evaluates Claude Code sessions on end to extract reusable patterns that can be saved as learned skills.

## When to Activate

- Setting up automatic pattern extraction from Claude Code sessions
- Configuring the Stop hook for session evaluation
- Reviewing or curating learned skills in `~/.claude/skills/learned/`
- Adjusting extraction thresholds or pattern categories
- Comparing v1 (this) vs v2 (instinct-based) approaches

## Status

This v1 skill is still supported, but `continuous-learning-v2` is the preferred path for new installs. Keep v1 when you explicitly want the simpler Stop-hook extraction flow or need compatibility with older learned-skill workflows.

## How It Works

This skill runs as a **Stop hook** at the end of each session:

1. **Session Evaluation**: Checks if session has enough messages (default: 10+)
2. **Pattern Detection**: Identifies extractable patterns from the session
3. **Skill Extraction**: Saves useful patterns to `~/.claude/skills/learned/`

## Configuration

Edit `config.json` to customize:

```json
{
  "min_session_length": 10,
  "extraction_threshold": "medium",
  "auto_approve": false,
  "learned_skills_path": "~/.claude/skills/learned/",
  "patterns_to_detect": [
    "error_resolution",
    "user_corrections",
    "workarounds",
    "debugging_techniques",
    "project_specific"
  ],
  "ignore_patterns": [
    "simple_typos",
    "one_time_fixes",
    "external_api_issues"
  ]
}
```

## Pattern Types

| Pattern | Description |
|---------|-------------|
| `error_resolution` | How specific errors were resolved |
| `user_corrections` | Patterns from user corrections |
| `workarounds` | Solutions to framework/library quirks |
| `debugging_techniques` | Effective debugging approaches |
| `project_specific` | Project-specific conventions |

## Hook Setup

Add to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning/evaluate-session.sh"
      }]
    }]
  }
}
```

## Why Stop Hook?

- **Lightweight**: Runs once at session end
- **Non-blocking**: Doesn't add latency to every message
- **Complete context**: Has access to full session transcript

## Related

- [The Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) - Section on continuous learning
- `/learn` command - Manual pattern extraction mid-session

---

## Comparison Notes (Research: Jan 2025)

### vs Homunculus

Homunculus v2 takes a more sophisticated approach:

| Feature | Our Approach | Homunculus v2 |
|---------|--------------|---------------|
| Observation | Stop hook (end of session) | PreToolUse/PostToolUse hooks (100% reliable) |
| Analysis | Main context | Background agent (Haiku) |
| Granularity | Full skills | Atomic "instincts" |
| Confidence | None | 0.3-0.9 weighted |
| Evolution | Direct to skill | Instincts → cluster → skill/command/agent |
| Sharing | None | Export/import instincts |

**Key insight from homunculus:**
> "v1 relied on skills to observe. Skills are probabilistic—they fire ~50-80% of the time. v2 uses hooks for observation (100% reliable) and instincts as the atomic unit of learned behavior."

### Potential v2 Enhancements

1. **Instinct-based learning** - Smaller, atomic behaviors with confidence scoring
2. **Background observer** - Haiku agent analyzing in parallel
3. **Confidence decay** - Instincts lose confidence if contradicted
4. **Domain tagging** - code-style, testing, git, debugging, etc.
5. **Evolution path** - Cluster related instincts into skills/commands

See: `docs/continuous-learning-v2-spec.md` for full spec.
