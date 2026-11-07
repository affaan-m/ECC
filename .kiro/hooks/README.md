# Hooks in Kiro

Kiro hooks automate agent and shell actions in response to IDE events.

## Format: v1 JSON (`*.json`)

All hooks are stored as `<hook-id>.json` in `.kiro/hooks/`.

### Schema

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "hook-name",
      "description": "What this hook does",
      "trigger": "PostFileSave",
      "matcher": "\\.(ts|tsx)$",
      "action": {
        "type": "agent",
        "prompt": "Prompt sent to the agent when triggered."
      },
      "enabled": false
    }
  ]
}
```

### Required Fields

| Field | Description |
|-------|-------------|
| `version` | Always `"v1"` |
| `hooks` | Array of hook definitions |
| `hooks[].name` | Hook identifier (kebab-case) |
| `hooks[].trigger` | Event that fires the hook (see below) |
| `hooks[].action` | Action to perform |
| `hooks[].enabled` | Whether the hook is active (`true` or `false`) |

### Optional Fields

| Field | Description |
|-------|-------------|
| `hooks[].description` | Human-readable description |
| `hooks[].matcher` | Regex to filter which events fire (depends on trigger) |

### Available Triggers

| Trigger | Fires when | Matcher tested against |
|---------|-----------|----------------------|
| `PreToolUse` | Before a tool is executed | Tool name |
| `PostToolUse` | After a tool is executed | Tool name |
| `SessionStart` | New session begins | — |
| `Stop` | Agent finishes responding | — |
| `UserPromptSubmit` | User submits a prompt | — |
| `PreTaskExec` | Before a spec task starts | — |
| `PostTaskExec` | After a spec task completes | — |
| `PostFileCreate` | File is created | File path |
| `PostFileSave` | File is saved | File path |
| `PostFileDelete` | File is deleted | File path |

### Action Types

**`agent`** — Sends a prompt to the agent:
```json
{ "type": "agent", "prompt": "Your instruction here." }
```

**`command`** — Runs a shell command:
```json
{ "type": "command", "command": "npm run lint" }
```

### Exit Code Semantics (command actions)

| Exit code | Meaning |
|-----------|---------|
| `0` | Success; stdout forwarded for SessionStart/UserPromptSubmit/PreToolUse |
| `2` | Block the action (PreToolUse, UserPromptSubmit, PreTaskExec); stderr forwarded |
| Other | Silent failure, no block |

### Matcher Best Practices

Matchers are regex patterns tested against tool names or file paths depending on trigger type.

**Use path-segment boundaries** for directory-based matchers to avoid false positives:
```json
"matcher": "(^|/)(auth|api|middleware)(/|$)"
```

This matches `src/auth/login.ts` but not `authorization.ts` or `rapid-api-client.js`.

**Use anchored extensions** for file-type matchers:
```json
"matcher": "\\.(ts|tsx)$"
```

### Default Activation States

Hooks ship with intentional default states:

| Default | Rationale | Hooks |
|---------|-----------|-------|
| **enabled** | Narrow scope, low frequency, high safety value | `git-push-review`, `code-review-on-write`, `doc-file-warning`, `tdd-reminder`, `security-check-on-create` |
| **disabled** | Fires frequently or per-response; opt in to manage credit usage | `auto-format`, `console-log-check`, `typecheck-on-edit`, `python-lint-on-edit`, `rust-check-on-edit`, `extract-patterns`, `session-summary`, `quality-gate` |

To enable a disabled hook, toggle it in the Agent Hooks panel or set `"enabled": true` in its JSON file.

### Quality Gate

The `quality-gate` hook runs build, lint, type check, and tests via `.kiro/scripts/quality-gate.sh`. It is disabled by default to avoid running the target project's full CI after every spec task.

**Opt-in paths:**
1. **Steering (recommended):** Use `#quality-gate` in chat to invoke on-demand
2. **Hook toggle:** Enable in the Agent Hooks panel for automatic PostTaskExec execution
3. **Manual:** Run `bash .kiro/scripts/quality-gate.sh` in terminal

See `.kiro/steering/quality-gate.md` for details.

---

## Installed Hooks

| Hook | Trigger | Matcher | Default | Description |
|------|---------|---------|---------|-------------|
| `auto-format` | PostFileSave | `\.(ts\|tsx\|js)$` | disabled | Format TS/JS files on save |
| `code-review-on-write` | PostToolUse | `fs_write\|str_replace\|fs_append` | enabled | Quick code review after writes |
| `console-log-check` | PostFileSave | `\.(js\|ts\|tsx)$` | disabled | Flag console.log statements |
| `doc-file-warning` | PostFileCreate | `(README\|CHANGELOG\|docs/\|\\.md$)` | enabled | Warn on unintended doc creation |
| `extract-patterns` | Stop | — | disabled | Suggest patterns for lessons-learned |
| `git-push-review` | PreToolUse | `execute_bash` | enabled | Review destructive git ops |
| `python-lint-on-edit` | PostFileSave | `\.py$` | disabled | Lint Python files on save |
| `quality-gate` | PostTaskExec | — | disabled | Full build/lint/test gate |
| `rust-check-on-edit` | PostFileSave | `\.rs$` | disabled | Check Rust compilation on save |
| `security-check-on-create` | PostFileCreate | `(^\|/)(auth\|api\|middleware)(/\|$)` | enabled | Security check in sensitive dirs |
| `session-summary` | Stop | — | disabled | Summarize session outcomes |
| `tdd-reminder` | PostFileCreate | `\.(ts\|tsx)$` | enabled | Remind about test coverage |
| `typecheck-on-edit` | PostFileSave | `\.(ts\|tsx)$` | disabled | Type check TS files on save |

---

## Legacy Format (historical reference)

The `*-legacy.kiro.hook` files in this directory use an older IDE-specific format from pre-1.0 Kiro. They are kept for reference only and are **not installed** by the installer. The v1 JSON files above are authoritative.

If migrating from `.kiro.hook` files, use this mapping:

| Legacy `when.type` | v1 `trigger` |
|--------------------|--------------|
| `fileEdited` | `PostFileSave` |
| `fileCreated` | `PostFileCreate` |
| `fileDeleted` | `PostFileDelete` |
| `userTriggered` | Use steering file (see quality-gate pattern) |
| `promptSubmit` | `UserPromptSubmit` |
| `agentStop` | `Stop` |
| `preToolUse` | `PreToolUse` |
| `postToolUse` | `PostToolUse` |

| Legacy `then.type` | v1 `action.type` |
|--------------------|-----------------|
| `askAgent` | `agent` |
| `runCommand` | `command` |

---

## Documentation

- Hooks guide: https://kiro.dev/docs/hooks/
- CLI hooks: https://kiro.dev/docs/cli/hooks/
