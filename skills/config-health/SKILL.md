---
name: config-health
description: Runtime configuration integrity monitoring for Claude Code. Detects config drift, rule staleness, and hook wiring gaps during sessions. Complements delivery-gate with session-duration soft monitoring.
metadata:
  origin: ECC
---

# Config Health

A real-time monitoring layer. delivery-gate blocks at session end; config-health catches problems during the session — when cheap to fix.

## When to Activate

- After installing delivery-gate and wanting defense in depth
- When hooks silently stop firing
- When config rules accumulate but you're unsure which still work
- At session startup for config integrity scan
- Before high-risk Edit/Write operations

## How It Works

Session Start → config-health scans rules/hooks (soft warnings, never blocks)
Session Work → config-health monitors hook wiring (PreToolUse guard)
Session End → delivery-gate verifies (hard block, exit 2)

Boundary: "Can this be fixed retroactively?" Config drift → config-health warns. Missing growth-log → delivery-gate blocks (hard exit 2).

## What It Monitors

1. Rule Health: scans rules, checks hook wiring, detects dead rules
2. Hook Wiring Audit: verifies scripts exist and are wired before high-risk calls
3. Guard Script Staleness: checks maintenance windows

## Examples

Catching silent hook failure:
SessionStart → health-check.py referenced in 3 docs, wired 0 times → WARN: dead references

PreToolUse guard:
three-questions-guard.py: referenced in BODY.md, exists on disk, wired in settings.json → Allow

Rule staleness:
rule "双池强制触发" last fired 15 sessions ago → WARN: may be dead

## Install

**ECC users:** install the `config-health` module (`npx ecc-install --modules config-health` or the `full` profile). It is a **Claude-only** module (SessionStart/PreToolUse hooks) — it does not target other harnesses, so it stays isolated from shared 13-harness modules.

**Standalone:** copy `scripts/config-health.py` to `~/.claude/scripts/config-health.py` and verify it exists before enabling.
**Important:** Merge these hook entries into your existing `hooks` object — do not replace it, or you will lose hooks like delivery-gate.

```json
{
  "hooks": {
    "SessionStart": [{"hooks": [{"type": "command", "command": "python3 ~/.claude/scripts/config-health.py --startup", "timeout": 5000}]}],
    "PreToolUse": [{"matcher": "Edit|Write", "hooks": [{"type": "command", "command": "python3 ~/.claude/scripts/config-health.py --pretool", "timeout": 3000}]}]
  }
}
```

## Design Principles

1. Never block on process monitoring — config-health warns; delivery-gate blocks
2. Check what delivery-gate can't — config behavior vs filesystem state
3. Zero false positives on hook wiring — missing script = fact, not heuristic

## Files

| File | Purpose | Hook |
|------|---------|------|
| scripts/config-health.py | Rule health, hook audit, staleness | SessionStart + PreToolUse |
