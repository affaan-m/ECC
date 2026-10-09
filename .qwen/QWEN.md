# ECC for Qwen Code

This file provides Qwen Code with the baseline ECC workflow, review standards, and security checks for installations that use the `qwen` target.

## Overview

ECC is a cross-harness coding system with 68 specialized agents, 293 skills, and 94 commands.

The Qwen target installs the full managed manifest surface into `~/.qwen/`: `rules/`, `agents/`, `commands/`, `skills/`, and `mcp-configs/`. Qwen Code loads both `~/.qwen/QWEN.md` and `~/.qwen/AGENTS.md` at the home level, so this file carries Qwen-specific guidance and leaves repo-wide operating rules to `AGENTS.md`.

For install layout, updating, and uninstalling, see `docs/QWEN-GUIDE.md`.

## Core Workflow

1. Plan before editing large features.
2. Prefer test-first changes for bug fixes and new functionality.
3. Review for security before shipping.
4. Keep changes self-contained, readable, and easy to revert.

## Coding Standards

- Prefer immutable updates over in-place mutation.
- Keep functions small and files focused.
- Validate user input at boundaries.
- Never hardcode secrets.
- Fail loudly with clear error messages instead of silently swallowing problems.

## Security Checklist

Before any commit:

- No hardcoded API keys, passwords, or tokens
- All external input validated
- Parameterized queries for database writes
- Sanitized HTML output where applicable
- Authz/authn checked for sensitive paths
- Error messages scrubbed of sensitive internals

## Delivery Standards

- Use conventional commits: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`
- Run targeted verification for touched areas before shipping
- Prefer contained local implementations over adding new third-party runtime dependencies

## Reading ECC Content On Qwen Code

ECC skills, rules, and agent prompts are authored against Claude Code tool names. Qwen Code uses different identifiers, so translate them when following instructions:

| In ECC content | Qwen Code tool |
| --- | --- |
| `Read` | `read_file` |
| `Write` | `write_file` |
| `Edit`, `MultiEdit` | `edit` |
| `Bash` | `run_shell_command` |
| `Grep` | `grep_search` |
| `Glob` | `glob` |
| `WebFetch` | `web_fetch` |
| `TodoWrite` | `todo_write` |
| `Task` | `agent` |
| `WebSearch` | not available; use `web_fetch` against a known URL |

Invoke a skill with the `skill` tool using the plain kebab-case name exactly as the session catalog lists it. Dispatch a subagent with the `agent` tool; top-level subagents run in the background and report through a completion notification rather than returning inline.

Some Qwen Code tools are deferred until their schema is reviewed — reach them with `tool_search`, then invoke them with `tool_call`. `web_fetch`, `send_message`, `task_stop`, and `record_artifact` are deferred by default, so a skill that names one of those is still actionable.

## Not Available On This Target

Hook runtime files are intentionally not selected for Qwen until its hook/event contract is confirmed (see the Scope section of `docs/QWEN-GUIDE.md`). Hook-driven ECC features therefore do not run here: do not report a hook-enforced guard, format-on-save pass, or cost-tracking metric as active. `mcp-configs/` ships connector baselines but is not merged into Qwen's own settings, so an MCP-backed skill needs its server registered before it can work.

## ECC Areas To Reuse

- `AGENTS.md` for repo-wide operating rules
- `skills/` for deep workflow guidance
- `commands/` for slash-command patterns worth adapting into prompts/macros
- `mcp-configs/` for shared connector baselines
