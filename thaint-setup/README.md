# thaint-setup

End-to-end Claude Code setup script. Installs and configures everything needed to run Claude Code with pre-configured agents, commands, hooks, and plugins.

This directory lives **inside** the ECC tree it installs from, so there is no
clone step and no version flag: whatever ref you have checked out is what gets
installed. To install a different version, check out that ref and re-run.

## Quick Start

```bash
bash thaint-setup/setup_claude.sh
```

### Fresh machine

```bash
git clone --branch v2.1.0 git@github.com:thaint2901/everything-claude-code.git \
  ~/everything-claude-code \
  && bash ~/everything-claude-code/thaint-setup/setup_claude.sh
```

Swap the `--branch` ref for whichever tag you want to install.

> **Note:** Requires an SSH key on your GitHub account.

## What It Does

1. **Installs Claude Code CLI** (if missing) from https://claude.ai/install.sh
2. **Skips onboarding** — marks `hasCompletedOnboarding=true` in `~/.claude.json`
3. **Adds marketplace + plugin** — `claude-md-management@claude-plugins-official`
4. **Copies directories** into `~/.claude/` (from this repo's checked-out tree):
   - `agents/`
   - `commands/`
   - `skills/configure-ecc`
   - `skills/strategic-compact`
5. **Installs hooks-runtime** — runs the ECC `install.sh` for hook support
6. **Installs Telegram hook** — writes `~/.claude/scripts/hooks/telegram-notify.js` and patches `settings.json`
7. **Patches `settings.json`** — adds statusline (context progress bar + model name)
8. **Installs MCP server catalog** — all 28 ECC MCP servers with env-var placeholders. Servers without required env vars stay disabled; set the env var to auto-enable. See [MCP servers](#mcp-servers) below.
9. **Installs global CLAUDE.md** — copies `thaint-setup/CLAUDE.base.md` to `~/.claude/CLAUDE.md` (applies across all projects)
10. **Patches shell rc** (`.zshrc` or `.bashrc`) — adds convenience alias and env var:
   ```bash
   alias clauded='claude --dangerously-skip-permissions'
   export CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1
   ```

## Options

| Flag | Description |
|---|---|
| `--dry-run` | Print actions without executing |
| `--verbose, -v` | Log every command |
| `-h, --help` | Show help |

To install a different ECC version, `git checkout` that ref and re-run — the
script installs the tree it lives in.

## Examples

```bash
# Default install (overwrites into ~/.claude)
bash thaint-setup/setup_claude.sh

# Dry run — see what would happen
bash thaint-setup/setup_claude.sh --dry-run

# Install a different version
git checkout v2.1.0 && bash thaint-setup/setup_claude.sh

# Configure Telegram notifications
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=123 bash thaint-setup/setup_claude.sh
```

## Environment Variables

| Variable | Description |
|---|---|
| `CLAUDE_INSTALL_URL` | Override the Claude CLI install URL |
| `CLAUDE_PLUGIN` | Override the plugin to install |
| `CLAUDE_MARKETPLACE_SOURCE` | Override the marketplace source |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for notification hook |
| `TELEGRAM_CHAT_ID` | Telegram chat ID for notification hook |

## MCP Servers

All 28 ECC MCP servers are installed with `${ENV_VAR}` placeholders. A server is **disabled by default** — if any required env var is unset, Claude Code cannot parse the entry and skips it. Set the env var in `~/.claude/settings.json` `env` block or in your shell profile to enable.

| Server | Required Env Var | Type |
|---|---|---|
| jira | `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | stdio |
| github | `GITHUB_PERSONAL_ACCESS_TOKEN` | stdio |
| firecrawl | `FIRECRAWL_API_KEY` | stdio |
| supabase | `SUPABASE_PROJECT_REF` | stdio |
| exa-web-search | `EXA_API_KEY` | stdio |
| fal-ai | `FAL_KEY` | stdio |
| browserbase | `BROWSERBASE_API_KEY` | stdio |
| browser-use | `BROWSER_USE_API_KEY` | http |
| confluence | `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN` | stdio |
| evalview | `OPENAI_API_KEY` (optional) | stdio |
| filesystem | `MCP_FILESYSTEM_PATH` (default: `$HOME`) | stdio |
| memory, context7, sequential-thinking, magic, playwright, token-optimizer, devfleet, insaits, omega-memory, vercel, railway, cloudflare-\*, clickhouse, laraplugins | None (always enabled) | varies |

## Requirements

- `bash` (script runs under bash regardless of login shell)
- `jq`
- `curl` (for CLI install)
- `git` (for ECC source resolution)
- `node` / `npm` (for hooks and Telegram hook)
