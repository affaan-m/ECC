---
name: ck
description: "Persistent per-project memory for Claude Code (Context Keeper) driven by deterministic Node.js /ck commands: init, save, resume, info, list, forget, and v1-to-v2 migrate, plus a SessionStart hook that injects a compact project brief. Use when context must survive across sessions, saving session state with next steps and decisions, resuming where a previous session left off, or picking up a project without re-explaining it."
metadata:
  version: 2.0.0
  origin: community
author: sreedhargs89
repo: https://github.com/sreedhargs89/context-keeper
---

# ck — Context Keeper

You are the **Context Keeper** assistant. When the user invokes any `/ck:*` command,
run the corresponding Node.js script and present its stdout to the user verbatim.
Scripts live in the `commands/` directory next to this SKILL.md (for example
`~/.claude/skills/ck/commands/` for a manual install, or the ck skill inside the ECC
plugin). The commands below refer to the skill directory as `${CLAUDE_SKILL_DIR}`,
which Claude Code fills in; in other hosts, replace it with the absolute path of the
directory containing this SKILL.md. Run the scripts from the project directory; do not
`cd` into the skill directory, because the scripts use the current directory as the
project path.

---

## Data Layout

```
~/.claude/ck/
├── projects.json              ← path → {name, contextDir, lastUpdated}
└── contexts/<name>/
    ├── context.json           ← SOURCE OF TRUTH (structured JSON, v2)
    └── CONTEXT.md             ← generated view — do not hand-edit
```

---

## Commands

### `/ck:init` — Register a Project
```bash
node "${CLAUDE_SKILL_DIR}/commands/init.mjs"
```
The script outputs JSON with auto-detected info. Present it as a confirmation draft:
```
Here's what I found — confirm or edit anything:
Project:     <name>
Description: <description>
Stack:       <stack>
Goal:        <goal>
Do-nots:     <constraints or "None">
Repo:        <repo or "none">
```
Wait for user approval. Apply any edits. Then pass the confirmed JSON to save.mjs --init
through a quoted heredoc (never `echo '...'`: an apostrophe in any field would end the
quoted string and hand the rest to the shell):
```bash
node "${CLAUDE_SKILL_DIR}/commands/save.mjs" --init <<'CK_JSON'
<confirmed-json>
CK_JSON
```
Confirmed JSON schema: `{"name":"...","path":"...","description":"...","stack":["..."],"goal":"...","constraints":["..."],"repo":"..." }`

---

### `/ck:save` — Save Session State
**This is the only command requiring LLM analysis.** Analyze the current conversation:
- `summary`: one sentence, max 10 words, what was accomplished
- `leftOff`: what was actively being worked on (specific file/feature/bug)
- `nextSteps`: ordered array of concrete next steps
- `decisions`: array of `{what, why}` for decisions made this session
- `blockers`: array of current blockers (empty array if none)
- `goal`: updated goal string **only if it changed this session**, else omit

Show a draft summary to the user: `"Session: '<summary>' — save this? (yes / edit)"`
Wait for confirmation. Then pass the JSON to save.mjs through a quoted heredoc:
```bash
node "${CLAUDE_SKILL_DIR}/commands/save.mjs" <<'CK_JSON'
<json>
CK_JSON
```
JSON schema (exact): `{"summary":"...","leftOff":"...","nextSteps":["..."],"decisions":[{"what":"...","why":"..."}],"blockers":["..."]}`
Display the script's stdout confirmation verbatim.

---

### `/ck:resume [name|number]` — Full Briefing
```bash
node "${CLAUDE_SKILL_DIR}/commands/resume.mjs" [arg]
```
Display output verbatim. Then ask: "Continue from here? Or has anything changed?"
If user reports changes → run `/ck:save` immediately.

---

### `/ck:info [name|number]` — Quick Snapshot
```bash
node "${CLAUDE_SKILL_DIR}/commands/info.mjs" [arg]
```
Display output verbatim. No follow-up question.

---

### `/ck:list` — Portfolio View
```bash
node "${CLAUDE_SKILL_DIR}/commands/list.mjs"
```
Display output verbatim. If user replies with a number or name → run `/ck:resume`.

---

### `/ck:forget [name|number]` — Remove a Project
First resolve the project name (run `/ck:list` if needed).
Ask: `"This will permanently delete context for '<name>'. Are you sure? (yes/no)"`
If yes:
```bash
node "${CLAUDE_SKILL_DIR}/commands/forget.mjs" [name]
```
Display confirmation verbatim.

---

### `/ck:migrate` — Convert v1 Data to v2
```bash
node "${CLAUDE_SKILL_DIR}/commands/migrate.mjs"
```
For a dry run first:
```bash
node "${CLAUDE_SKILL_DIR}/commands/migrate.mjs" --dry-run
```
Display output verbatim. Migrates all v1 CONTEXT.md + meta.json files to v2 context.json.
Originals are backed up as `meta.json.v1-backup` — nothing is deleted.

---

## SessionStart Hook

The hook at `hooks/session-start.mjs` in this skill's directory must be registered in
`~/.claude/settings.json` to auto-load project context on session start. For a manual
install in `~/.claude/skills/ck`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/skills/ck/hooks/session-start.mjs\"" }] }
    ]
  }
}
```

Use `$HOME`, not `~`: the shell does not expand `~` inside double quotes. If ck lives
elsewhere (for example inside the ECC plugin), use the absolute path of its
`hooks/session-start.mjs` instead.

The hook injects ~100 tokens per session (compact 5-line summary). It also detects
unsaved sessions, git activity since last save, and goal mismatches vs CLAUDE.md.

---

## Rules
- Always expand `~` as `$HOME` in Bash calls.
- Commands are case-insensitive: `/CK:SAVE`, `/ck:save`, `/Ck:Save` all work.
- If a script exits with code 1, display its stdout as an error message.
- Never edit `context.json` or `CONTEXT.md` directly — always use the scripts.
- If `projects.json` is malformed, tell the user and offer to reset it to `{}`.
