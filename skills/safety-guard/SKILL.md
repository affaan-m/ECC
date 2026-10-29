---
name: safety-guard
description: "Guard against destructive operations with three modes: Careful intercepts dangerous commands (rm -rf, git push --force, DROP TABLE) for confirmation, Freeze locks writes to one directory, and Guard combines both. Advisory: the agent applies these rules itself; no hook ships with it. Use when working on production systems, running agents autonomously, restricting edits to a directory, or during migrations, deploys, and data changes."
metadata:
  origin: ECC
---

# Safety Guard — Prevent Destructive Operations

## When to Use

- When working on production systems
- When agents are running autonomously (full-auto mode)
- When you want to restrict edits to a specific directory
- During sensitive operations (migrations, deploys, data changes)

## How It Works

Three modes of protection. They are instructions the agent follows, not enforced blocks (see [Enforcement](#enforcement)).

### Mode 1: Careful Mode

Before it runs a destructive command, the agent stops and warns:

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

Locks file edits to a specific directory tree, for example: "freeze edits to `src/components/`".

The agent does not Write/Edit outside `src/components/`, and explains why when a change would need it. Useful when you want an agent to focus on one area without touching unrelated code.

### Mode 3: Guard Mode (Careful + Freeze combined)

Both protections active, for example: "guard mode, write only to `src/api/`, read anything".

The agent can read anything but only writes to `src/api/`, and asks before any destructive command.

### Unlock

Tell the agent to stop applying the rules.

## Enforcement

This skill is advisory. ECC ships no `/safety-guard` command and no hook for it, so nothing blocks a tool call that breaks these rules. For blocking that does not depend on the agent, use Claude Code [permission deny rules](https://code.claude.com/docs/en/permissions) (for example `Bash(rm -rf *)`) or a [PreToolUse hook](https://code.claude.com/docs/en/hooks).

## Integration

- Enable by default for `codex -a never` sessions
- Pair with observability risk scoring in ECC 2.0
