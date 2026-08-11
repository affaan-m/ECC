# Hooks System

## Hook Types

- **PreToolUse**: Before tool execution (validation, parameter modification)
- **PostToolUse**: After tool execution (auto-format, checks)
- **Stop**: When session ends (final verification)
- **PreCompact**: Before context compaction
- **SessionStart**: When a new session begins
- **SessionEnd**: When a session ends

## Hook Scope: Global vs Project

Hooks are split into two scopes to prevent cross-language pollution:

### Global Hooks (in ~/.claude/settings.json)

Applied to ALL projects. Contains language-agnostic and infrastructure hooks:

**Common (language-agnostic):**

- **git push review**: Reminder to review changes before push
- **doc blocker**: Blocks creation of unnecessary .md/.txt files
- **PR creation**: Logs PR URL and provides review command
- **markdownlint**: Lints .md files after edits

**Node infrastructure (bun, safety-wrapped):**

- **pre-compact**: Saves state before context compaction
- **session-start**: Loads previous context and detects package manager
- **session-end**: Persists session state

### Project Hooks (in .claude/settings.json per project)

Applied only to the current project. Initialize with:

```bash
~/.claude/scripts/../init-project.sh node
```

#### PreToolUse

- **dev server blocker**: Blocks dev servers outside zellij (tmux also accepted)
- **zellij reminder**: Suggests zellij for long-running commands (bun, npm, pnpm, yarn, cargo, etc.)

#### PostToolUse

- **build analysis**: Async hook for build analysis (background)
- **oxfmt**: Auto-formats JS/TS/Svelte files after edit
- **TypeScript check**: Runs tsc after editing .ts/.tsx files
- **console.log warning**: Warns about console.log in edited files

#### Stop

- **console.log audit**: Checks all modified files for console.log before session ends

## Auto-Accept Permissions

Use with caution:

- Enable for trusted, well-defined plans
- Disable for exploratory work
- Never use dangerously-skip-permissions flag
- Configure `allowedTools` in `~/.claude.json` instead

## TodoWrite Best Practices

Use TodoWrite tool to:

- Track progress on multi-step tasks
- Verify understanding of instructions
- Enable real-time steering
- Show granular implementation steps

Todo list reveals:

- Out of order steps
- Missing items
- Extra unnecessary items
- Wrong granularity
- Misinterpreted requirements
