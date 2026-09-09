---
description: Render a token-usage stat card from local agent session logs and commit it to the repo. Invokes the token-card skill.
argument-hint: [--out PATH] [--theme auto|light|dark] [--dry-run]
---

# Token Card

Thin compatibility shim. The workflow lives in the **token-card** skill
(`skills/token-card/SKILL.md`), which is the canonical surface; this command exists so the
slash-command harnesses can reach it.

## Usage

```
/token-card                       # write ./tokenchit.svg
/token-card --out docs/usage.svg  # write somewhere else
/token-card --theme dark
/token-card --dry-run             # report what would be written, write nothing
```

## What it does

Renders an SVG card of this machine's AI coding agent usage — tokens, equivalent cost,
streak, per-agent split — from local Claude Code, Codex and OpenCode session logs, and writes
it into the working tree as a file the README can reference.

Follow the skill for the full workflow, including the confirmation required before the first
registry download, the pinned CLI version, and the dry-run rules.
