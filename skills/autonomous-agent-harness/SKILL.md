---
name: autonomous-agent-harness
description: Transform Claude Code into a fully autonomous agent system with persistent memory, scheduled operations, computer use, and task queuing. Replaces standalone agent frameworks (Hermes, AutoGPT) by leveraging Claude Code's native crons, dispatch, MCP tools, and memory. Use when the user wants continuous autonomous operation, scheduled tasks, or a self-directing agent loop.
metadata:
  origin: ECC
---

# Autonomous Agent Harness

Combine Claude Code's session tools with separately configured scheduling, memory, and computer-use integrations. This is a setup pattern, not a bundled always-on runtime.

## Consent and Safety Boundaries

Autonomous operation must be explicitly requested and scoped by the user. Do not create schedules, dispatch remote agents, write persistent memory, use computer control, post externally, modify third-party resources, or act on private communications unless the user has approved that capability and the target workspace for the current setup.

Prefer dry-run plans and local queue files before enabling recurring or event-driven actions. Keep credentials, private workspace exports, personal datasets, and account-specific automations out of reusable ECC artifacts.

## When to Activate

- User wants an agent that runs continuously or on a schedule
- Setting up automated workflows that trigger periodically
- Building a personal AI assistant that remembers context across sessions
- User says "run this every day", "check on this regularly", "keep monitoring"
- Wants to replicate functionality from Hermes, AutoGPT, or similar autonomous agent frameworks
- Needs computer use combined with scheduled execution

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Claude Code Runtime                        │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │  Crons   │  │ Dispatch │  │ Memory   │  │ Computer    │ │
│  │ Schedule │  │ Remote   │  │ Store    │  │ Use         │ │
│  │ Tasks    │  │ Agents   │  │          │  │             │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬──────┘ │
│       │              │             │                │        │
│       ▼              ▼             ▼                ▼        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              ECC Skill + Agent Layer                  │    │
│  │                                                      │    │
│  │  skills/     agents/     commands/     hooks/        │    │
│  └──────────────────────────────────────────────────────┘    │
│       │              │             │                │        │
│       ▼              ▼             ▼                ▼        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              MCP Server Layer                        │    │
│  │                                                      │    │
│  │  memory    github    exa    supabase    browser-use  │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Persistent Memory

Use Claude Code's built-in memory system enhanced with MCP memory server for structured data.

**Built-in memory** (`~/.claude/projects/*/memory/`):
- User preferences, feedback, project context
- Stored as markdown files with frontmatter
- Automatically loaded at session start

**MCP memory server** (structured knowledge graph):
- Entities, relations, observations
- Queryable graph structure
- Cross-session persistence

**Memory patterns:**

```
# Short-term: current session context
Use TodoWrite for in-session task tracking

# Medium-term: project memory files
Write to ~/.claude/projects/*/memory/ for cross-session recall

# Long-term: MCP knowledge graph
Use mcp__memory__create_entities for permanent structured data
Use mcp__memory__create_relations for relationship mapping
Use mcp__memory__add_observations for new facts about known entities
```

### 2. Scheduled Operations (Crons)

Use Claude Code's native [scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks) for recurring prompts within an interactive session. These tasks are session-scoped; an external scheduler is required for work that must run independently of an open session. No scheduling MCP server is required for `/loop`.

**Setting up a cron:**

```
# In an interactive Claude Code session
/loop 30m Review open PRs in this repository and summarize CI failures.
```

For a one-shot run from a shell, set the working directory before invoking the CLI:

```bash
cd "/path/to/repo" && claude -p "Review open PRs and summarize"
```

Use an OS scheduler or CI schedule to invoke that command repeatedly when no interactive session is running. Configure the runner's authentication and tool permissions separately.

**Useful cron patterns:**

| Pattern | Schedule | Use Case |
|---------|----------|----------|
| Daily standup | `0 9 * * 1-5` | Review PRs, issues, deploy status |
| Weekly review | `0 10 * * 1` | Code quality metrics, test coverage |
| Hourly monitor | `0 * * * *` | Production health, error rate checks |
| Nightly build | `0 2 * * *` | Run full test suite, security scan |
| Pre-meeting | `*/30 * * * *` | Prepare context for upcoming meetings |

### 3. Dispatch / Remote Agents

Have an authenticated CI job or webhook receiver invoke Claude Code in a workspace it owns. The supported entrypoint is [programmatic CLI mode](https://code.claude.com/docs/en/headless), not a public Anthropic dispatch endpoint.

**Dispatch patterns:**

```bash
# Run inside the CI workspace
cd "/path/to/repo" && claude -p "Build failed on main. Diagnose the failure."

# Trigger from webhook
# GitHub webhook -> authenticated CI runner -> claude -p -> reviewable result

# Trigger from another agent
claude -p "Analyze the output of the security scan and create issues for findings"
```

### 4. Computer Use

Computer control needs a separately configured integration. Anthropic's [computer-use tool and reference environment](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) require an application to execute tool calls in an isolated desktop environment. Adding an MCP package name does not supply that environment.

**Capabilities:**
- Browser automation (navigate, click, fill forms, screenshot)
- Desktop control (open apps, type, mouse control)
- File system operations beyond CLI

**Use cases within the harness:**
- Automated testing of web UIs
- Form filling and data entry
- Screenshot-based monitoring
- Multi-app workflows

### 5. Task Queue

Manage a persistent queue of tasks that survive session boundaries.

**Implementation:**

```
# Task persistence via memory
Write task queue to ~/.claude/projects/*/memory/task-queue.md

# Task format
---
name: task-queue
type: project
description: Persistent task queue for autonomous operation
---

## Active Tasks
- [ ] PR #123: Review and approve if CI green
- [ ] Monitor deploy: check /health every 30 min for 2 hours
- [ ] Research: Find 5 leads in AI tooling space

## Completed
- [x] Daily standup: reviewed 3 PRs, 2 issues
```

## Replacing Hermes

| Hermes Component | ECC Equivalent | How |
|------------------|---------------|-----|
| Gateway/Router | CLI + external scheduler | An authenticated runner starts agent sessions |
| Memory System | Claude memory + MCP memory server | Built-in persistence + knowledge graph |
| Tool Registry | MCP servers | Dynamically loaded tool providers |
| Orchestration | ECC skills + agents | Skill definitions direct agent behavior |
| Computer Use | Separately configured integration | Browser or desktop control in an isolated environment |
| Context Manager | Session management + memory | ECC 2.0 session lifecycle |
| Task Queue | Memory-persisted task list | TodoWrite + memory files |

## Setup Guide

### Step 1: Configure MCP Servers

Memory MCP is optional. The [MCP reference memory server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) is published as `@modelcontextprotocol/server-memory`; version `2026.8.31` was verified on the public npm registry on 2026-09-07. It is a reference implementation, not an ECC-bundled service.

After reviewing that package and approving its use, merge this entry into the user-scoped MCP configuration in `~/.claude.json`, preserving existing settings. Replace `MEMORY_FILE_PATH` with an absolute path in a private directory you own. See [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp) for CLI registration and Windows `cmd /c npx` configuration.

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory@2026.8.31"],
      "env": {
        "MEMORY_FILE_PATH": "/absolute/path/to/private/memory.jsonl"
      }
    }
  }
}
```

Do not register guessed or unpublished npm packages: `npx -y` would execute whatever is later published under that name. Verify the exact package, publisher, and version before adding another server. Scheduling and computer use do not require the three unpublished package names previously listed here.

### Step 2: Create Base Crons

For polling during an interactive session, enter:

```text
/loop 30m Review open PRs in this repository and summarize CI failures.
```

For daily or weekly work that must survive a closed session, configure an external scheduler, such as an OS cron job or GitHub Actions, to run the one-shot command from Step 2 of Core Components. Calling `claude -p` to request a schedule does not provision an always-on scheduler. Choose the schedule, workspace, and allowed actions explicitly before enabling it.

### Step 3: Initialize Memory Graph

```bash
# Bootstrap your identity and context
claude -p "Create memory entities for: me (user profile), my projects, my key contacts. Add observations about current priorities."
```

### Step 4: Enable Computer Use (Optional)

Follow the computer-use reference environment linked above, or the documentation for a specific browser integration you have reviewed. Grant only the required permissions and verify a harmless action in the isolated environment before adding it to scheduled workflows.

## Example Workflows

### Autonomous PR Reviewer
```
Cron: every 30 min during work hours
1. Check for new PRs on watched repos
2. For each new PR:
   - Pull branch locally
   - Run tests
   - Review changes with code-reviewer agent
   - Post review comments via GitHub MCP
3. Update memory with review status
```

### Personal Research Agent
```
Cron: daily at 6 AM
1. Check saved search queries in memory
2. Run Exa searches for each query
3. Summarize new findings
4. Compare against yesterday's results
5. Write digest to memory
6. Flag high-priority items for morning review
```

### Meeting Prep Agent
```
Trigger: 30 min before each calendar event
1. Read calendar event details
2. Search memory for context on attendees
3. Pull recent email/Slack threads with attendees
4. Prepare talking points and agenda suggestions
5. Write prep doc to memory
```

## Constraints

- Native scheduled prompts share their interactive session. External scheduler invocations start separate sessions unless explicitly resumed.
- Computer use requires explicit permission grants. Don't assume access.
- CLI automation still consumes model usage and is subject to the configured provider's limits. Choose appropriate scheduler intervals.
- Memory files should be kept concise. Archive old data rather than letting files grow unbounded.
- Always verify that scheduled tasks completed successfully. Add error handling to cron prompts.
