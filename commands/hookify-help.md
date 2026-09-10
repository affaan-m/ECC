---
description: Get help with the hookify system
---

Display comprehensive hookify documentation.

## Hook System Overview

Hookify creates rule files that integrate with Claude Code's hook system to prevent unwanted behaviors.
ECC's built-in runtime loads these rules automatically while plugin hooks are
enabled; installing a separate Hookify plugin is not required.

### Event Types

- `bash`: triggers on Bash tool use and matches command patterns
- `file`: triggers on Write/Edit tool use and matches file paths
- `stop`: triggers after each Claude response
- `prompt`: triggers on user message submission and matches input patterns
- `all`: triggers on all events

### Rule File Format

Files are stored as `.claude/hookify.{name}.local.md`:

```yaml
---
name: descriptive-name
enabled: true
event: bash|file|stop|prompt|all
action: block|warn
pattern: "regex pattern to match"
---
Message to display when rule triggers.
Supports multiple lines.
```

### Commands

- `/hookify [description]` creates new rules and auto-analyzes the conversation when no description is given
- `/hookify-list` lists configured rules
- `/hookify-configure` toggles rules on or off

### Pattern Tips

- use regex syntax
- for `bash`, match against the full command string
- for `file`, match against the file path
- test patterns before deploying
- avoid nested quantifiers such as `(a+)+`; the runtime rejects unsafe regexes
- every regex evaluation also has a 25 ms hard timeout
- malformed or oversized rules fail open with a diagnostic so one bad local rule cannot disable all hooks
- Git-tracked local rules require explicit `ECC_HOOKIFY_ALLOW_TRACKED=1` approval

### Action Behavior

- `warn` adds the rule message to Claude's context and allows processing to continue
- `block` denies matching shell/file actions before execution
- `block` on prompt, post-tool, or stop events uses that event's structured block decision
- stop rules are skipped when `stop_hook_active` is already true to prevent loops
