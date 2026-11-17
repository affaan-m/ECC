# Hook Integration for Session-Stop Self-Evaluation

Add this hook to `hooks/hooks.json` to remind the agent to self-evaluate at the end of every session (the hook echoes a reminder; it does not run the evaluator automatically):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo '[Self-Eval] Session complete. Consider running agent-self-evaluation to rate your output.'"
          }
        ],
        "description": "Remind agent to self-evaluate at session end"
      }
    ]
  }
}
```

`Stop` events do not require a `matcher` field (it is optional for `Stop`, `Notification`, `UserPromptSubmit`, and `SubagentStop` per `scripts/ci/validate-hooks.js`). If omitted, the hook object only needs `hooks` and metadata such as `description`.

## Integration with the Python Evaluator

The `scripts/evaluate.py` script can be used as a standalone tool:

```bash
# Pipe agent output directly
echo "Your agent response here" | python3 skills/agent-self-evaluation/scripts/evaluate.py

# From files
python3 skills/agent-self-evaluation/scripts/evaluate.py --task task.txt --output response.txt
```

To integrate it into hooks, capture the last agent output to a file first, then run the evaluator. For lightweight reminders after shell-based verification, use a simple supported matcher string:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo '[Self-Eval] If this command completed verification for a non-trivial task, consider running agent-self-evaluation.'"
          }
        ],
        "description": "Remind agent to self-evaluate after shell verification"
      }
    ]
  }
}
```

This avoids documenting unsupported command-expression matcher syntax. If your harness supports command-level matcher expressions, prefer a word-boundary regex such as `\b(pytest|npm test|go test)\b` rather than a broad `test` substring.

These hooks are opt-in. Add them to your local `hooks/hooks.json` if you want automated evaluation prompts.

## Manual Usage (Recommended)

The most reliable approach is manual invocation — the agent runs self-evaluation as part of its workflow when the `agent-self-evaluation` skill is active, without requiring hook configuration. The skill's "When to Activate" section already covers trigger conditions (multi-file changes, debugging sessions, design documents).
