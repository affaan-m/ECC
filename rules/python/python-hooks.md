# Hooks System

## Hook Types

- **PreToolUse**: Before tool execution (validation, parameter modification)
- **PostToolUse**: After tool execution (auto-format, checks)
- **Stop**: When session ends (final verification)

## Hook Scope: Global vs Project

Hooks are split into two scopes to prevent cross-language pollution:

### Global Hooks (in ~/.claude/settings.json)

Applied to ALL projects. Contains language-agnostic hooks only:

- **git push review**: Reminder to review changes before push
- **doc blocker**: Blocks creation of unnecessary .md/.txt files
- **PR creation**: Logs PR URL and provides review command
- **markdownlint**: Lints .md files after edits

### Project Hooks (in .claude/settings.json per project)

Applied only to the current project. Initialize with:

```bash
~/.claude/scripts/../init-project.sh python
```

#### PreToolUse

- **zellij blocker**: Blocks dev servers (uvicorn, gunicorn, manage.py runserver) outside zellij (tmux also accepted)
- **pip blocker**: Blocks pip install - enforces uv sync instead
- **zellij reminder**: Suggests zellij for long-running commands (uv sync, pytest, docker, make)

#### PostToolUse

- **ruff format**: Auto-formats .py files after edit
- **ruff check**: Lints .py files after edit
- **ty check**: Type checks .py files after edit
- **print() warning**: Warns about print() in edited files
- **test notification**: Notification after pytest/manage.py test completion

#### Stop

- **print() audit**: Checks all modified .py files for print() before session ends

## Package Management

Always use uv, never pip:

- `uv sync --group docs --group dev` for dev setup
- `uv sync --group docs --group dev --extra cu128` for CUDA support
- `uv run <command>` to execute within venv
- All hook commands run via `uv run python3 -c`

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
