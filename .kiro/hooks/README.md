# Hooks in Kiro

Kiro hooks automate agent and shell actions in response to IDE events.

## Primary Format: JSON (`*.json`)

The canonical hook format is JSON, stored as `<hook-id>.json` in `.kiro/hooks/`.

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
      "enabled": true
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
| `hooks[].enabled` | Whether the hook is active |

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
| `Manual` | Manually triggered from panel | — |

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

### Example

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "typecheck-on-edit",
      "description": "Run TypeScript type checking when TS files are saved",
      "trigger": "PostFileSave",
      "matcher": "\\.(ts|tsx)$",
      "action": {
        "type": "agent",
        "prompt": "A TypeScript file was just saved. Check for type errors."
      },
      "enabled": true
    }
  ]
}
```

---

## Legacy Format: `.kiro.hook` (deprecated)

The `*-legacy.kiro.hook` files in this directory use an older IDE-specific format. They are kept for reference but are **no longer the canonical source**. The JSON files above are authoritative.

### Legacy Schema

```json
{
  "version": "1.0.0",
  "enabled": true,
  "name": "hook-name",
  "description": "What this hook does",
  "when": {
    "type": "fileEdited",
    "patterns": ["*.ts", "*.tsx"]
  },
  "then": {
    "type": "askAgent",
    "prompt": "Prompt text."
  }
}
```

### Legacy → JSON Trigger Mapping

| Legacy `when.type` | JSON `trigger` |
|--------------------|----------------|
| `fileEdited` | `PostFileSave` |
| `fileCreated` | `PostFileCreate` |
| `fileDeleted` | `PostFileDelete` |
| `userTriggered` | `Manual` |
| `promptSubmit` | `UserPromptSubmit` |
| `agentStop` | `Stop` |
| `preToolUse` | `PreToolUse` |
| `postToolUse` | `PostToolUse` |

### Legacy → JSON Action Mapping

| Legacy `then.type` | JSON `action.type` |
|--------------------|-------------------|
| `askAgent` | `agent` |
| `runCommand` | `command` |

---

## Documentation

- Hooks guide: https://kiro.dev/docs/hooks/
- CLI hooks: https://kiro.dev/docs/cli/hooks/
