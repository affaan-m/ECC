---
name: safety-guard
description: Use this skill to prevent destructive operations when working on production systems or running agents autonomously.
---

# Safety Guard — Prevent Destructive Operations

## When to Use

- When working on production systems
- When agents are running autonomously (full-auto mode)
- When you want to restrict edits to a specific directory
- During sensitive operations (migrations, deploys, data changes)

## How It Works

Three modes of protection:

### Mode 1: Careful Mode

Intercepts destructive commands before execution and warns:

```
Watched patterns:
- rm -rf (especially /, ~, or project root)
- git push --force
- git reset --hard
- git checkout . (discard all changes)
- DROP TABLE / DROP DATABASE
- docker system prune
- kubectl delete
- chmod 777
- sudo rm
- npm publish (accidental publishes)
- Any command with --no-verify
```

When detected: shows what the command does, asks for confirmation, suggests safer alternative.

### Mode 2: Freeze Mode

Locks file edits to a specific directory tree:

```
/safety-guard freeze src/components/
```

Any Write/Edit outside `src/components/` is blocked with an explanation. Useful when you want an agent to focus on one area without touching unrelated code.

### Mode 3: Guard Mode (Careful + Freeze combined)

Both protections active. Maximum safety for autonomous agents.

```
/safety-guard guard --dir src/api/ --allow-read-all
```

Agents can read anything but only write to `src/api/`. Destructive commands are blocked everywhere.

### Unlock

```
/safety-guard off
```

## Implementation

Uses PreToolUse hooks to intercept Bash, Write, Edit, and MultiEdit tool calls. Checks the command/path against the active rules before allowing execution.

## Integration

- Enable by default for `codex -a never` sessions
- Pair with observability risk scoring in ECC 2.0
- Logs all blocked actions to `~/.claude/safety-guard.log`
