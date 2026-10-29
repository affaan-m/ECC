# Manual Adaptation Guide for Non-Native Harnesses

Use this guide when you want ECC behavior inside a harness that does not natively load `.claude/`, `.codex/`, `.opencode/`, `.cursor/`, or `.agent/` layouts.

This is the fallback path for tools like Grok and other chat-style interfaces that can accept system prompts, uploaded files, or pasted instructions, but cannot execute the repo's native install surfaces directly.

## When to Use This

Use manual adaptation when the target harness:

- does not auto-load repo folders
- does not support custom slash commands
- does not support hooks
- does not support repo-local skill activation
- has partial or no filesystem/tool access

Prefer a first-class ECC target whenever one exists:

- Claude Code
- Codex
- Cursor
- OpenCode
- CodeBuddy
- Antigravity

Use this guide only when you need ECC behavior in a non-native harness.

## What You Are Reproducing

When you adapt ECC manually, you are trying to preserve four things:

1. Focused context instead of dumping the whole repo.
2. Skill activation cues instead of hoping the model guesses the workflow.
3. Command intent even when the harness has no slash-command system.
4. Hook discipline even when the harness has no native automation.

You are not trying to mirror every file in the repo. You are trying to recreate the useful behavior with the smallest possible context bundle.

## The ECC-Native Fallback

Default to manual selection from the repo itself.

Start with only the files you actually need:

- one language or framework skill
- one workflow skill
- one domain skill if the task is specialized
- one agent or command only if the harness benefits from explicit orchestration

Good minimal examples:

- Python feature work:
  - `skills/python-patterns/SKILL.md`
  - `skills/tdd-workflow/SKILL.md`
  - `skills/verification-loop/SKILL.md`
- TypeScript API work:
  - `skills/backend-patterns/SKILL.md`
  - `skills/security-review/SKILL.md`
  - `skills/tdd-workflow/SKILL.md`
- Content/outbound work:
  - `skills/brand-voice/SKILL.md`
  - `skills/content-engine/SKILL.md`
  - `skills/crosspost/SKILL.md`

If the harness supports file upload, upload only those files.

If the harness only supports pasted context, extract the relevant sections and paste a compressed bundle rather than the raw full files.

## Manual Context Packing

You do not need extra tooling to do this.

Use the repo directly:

```bash
cd /path/to/ECC

sed -n '1,220p' skills/tdd-workflow/SKILL.md > /tmp/ecc-context.md
printf '\n\n---\n\n' >> /tmp/ecc-context.md
sed -n '1,220p' skills/backend-patterns/SKILL.md >> /tmp/ecc-context.md
printf '\n\n---\n\n' >> /tmp/ecc-context.md
sed -n '1,220p' skills/security-review/SKILL.md >> /tmp/ecc-context.md
```

You can also use `rg` to identify the right skills before packing:

```bash
rg -n "When to use|Use when|Trigger" skills -g 'SKILL.md'
```

Optional: if you already use a repo packer like `repomix`, it can help compress selected files into one handoff document. It is a convenience tool, not the canonical ECC path.

## Compression Rules

When manually packing ECC for another harness:

- keep the task framing
- keep the activation conditions
- keep the workflow steps
- keep the critical examples
- remove repetitive prose first
- remove unrelated variants second
- avoid pasting whole directories when one or two skills are enough

If you need a tighter prompt format, convert the essential parts into a compact structured block:

```xml
<skill name="tdd-workflow">
  <when>New feature, bug fix, or refactor that should be test-first.</when>
  <steps>
    <step>Write a failing test.</step>
    <step>Make it pass with the smallest change.</step>
    <step>Refactor and rerun validation.</step>
  </steps>
</skill>
```

## Reproducing Commands

If the harness has no slash-command system, define a small command registry in the system prompt or session preamble.

Example:

```text
Command registry:
- /plan -> use planner-style reasoning, produce a short execution plan, then act
- /tdd -> follow the tdd-workflow skill
- /review -> switch into code-review mode and enumerate findings first
- /verify -> run a verification loop before claiming completion
```

You are not implementing real commands. You are giving the harness explicit invocation handles that map to ECC behavior.

## Reproducing Hooks

If the harness has no native hooks, move the hook intent into the standing instructions.

Example:

```text
Before writing code:
1. Check whether a relevant skill should be activated.
2. Check for security-sensitive changes.
3. Prefer tests before implementation when feasible.

Before finalizing:
1. Re-read the user request.
2. Verify the main changed paths.
3. State what was actually validated and what was not.
```

That does not recreate true automation, but it captures the operational discipline of ECC.

## Harness Capability Matrix

| Capability | First-Class ECC Targets | Manual-Adaptation Targets |
| --- | --- | --- |
| Folder-based install | Native | No |
| Slash commands | Native | Simulated in prompt |
| Hooks | Native | Simulated in prompt |
| Skill activation | Native | Manual |
| Repo-local tooling | Native | Depends on harness |
| Context packing | Optional | Required |

## Practical Grok-Style Setup

1. Pick the smallest useful bundle.
2. Pack the selected ECC skill files into one upload or paste block.
3. Add a short command registry.
4. Add standing “hook intent” instructions.
5. Start with one task and verify the harness follows the workflow before scaling up.

Example starter preamble:

```text
You are operating with a manually adapted ECC bundle.

Active skills:
- backend-patterns
- tdd-workflow
- security-review

Command registry:
- /plan
- /tdd
- /verify

Before writing code, follow the active skill instructions.
Before finalizing, verify what changed and report any remaining gaps.
```

## Limitations

Manual adaptation is useful, but it is still second-class compared with native targets.

You lose:

- automatic install and sync
- native hook execution
- true command plumbing
- reliable skill discovery at runtime
- built-in multi-agent/worktree orchestration

So the rule is simple:

- use manual adaptation to carry ECC behavior into non-native harnesses
- use native ECC targets whenever you want the full system

## Related Work

- [Issue #1186](https://github.com/affaan-m/ECC/issues/1186)
- [Discussion #1077](https://github.com/affaan-m/ECC/discussions/1077)
- [Antigravity Guide](./ANTIGRAVITY-GUIDE.md)
- [Troubleshooting](./TROUBLESHOOTING.md)
