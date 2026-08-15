---
name: jira-integration
description: Use this skill when retrieving Jira tickets, analyzing requirements, updating ticket status, adding comments, or transitioning issues. Provides Jira API patterns via MCP or direct REST calls.
metadata:
  origin: ECC
---

# Jira Integration Skill

Retrieve, analyze, and update Jira tickets directly from your AI coding workflow. Supports both **MCP-based** (recommended) and **direct REST API** approaches.

## When to Activate

- Fetching a Jira ticket to understand requirements
- Extracting testable acceptance criteria from a ticket
- Adding progress comments to a Jira issue
- Transitioning a ticket status (To Do → In Progress → Done)
- Linking merge requests or branches to a Jira issue
- Searching for issues by JQL query

## Prerequisites

### Option A: MCP Server (Recommended)

Use **jira-cli** (<https://github.com/LuPaLa-Coder/mcp_jira>) — a dual-mode CLI and MCP server in C#/.NET 8 exposing 68 MCP tools (30 core documented in the repo's `SERVICES.md`). Single self-contained binary; no Python/uvx runtime required.

**Requirements:**
- The `jira` binary on PATH (per-platform binaries in the repo's `publish/` folder, or build from source with `dotnet publish`)

**Add to your MCP config** (e.g., `~/.claude.json` → `mcpServers`):

```json
{
  "jira": {
    "command": "jira",
    "args": ["mcp", "serve"]
  }
}
```

> **Security:** Credentials never go in the MCP config. jira-cli reads them from its own local config (`~/.config/jira-cli/config.json`; `jira config path` prints the location). Never hardcode tokens in source code or committed files.

**Register your Jira instance:**

```bash
# Jira Cloud (Basic Auth → REST v3 auto)
jira config add --site myco \
  --url https://YOUR_ORG.atlassian.net \
  --email your.email@example.com \
  --token <api-token>

# Jira Server / Data Center (Bearer PAT → REST v2 auto)
jira config add --site eng \
  --url https://jira.yourcompany.com/jira \
  --token <personal-access-token> \
  --auth-mode bearer

# Verify
jira context
```

Multi-site: configure several sites and switch with `--site` on any tool, the `JIRA_SITE` env var, or the `defaultSite` config key.

**To get a Jira API token:**
1. Go to <https://id.atlassian.com/manage-profile/security/api-tokens>
2. Click **Create API token**
3. Copy the token — store it in jira-cli's local config, never in source code

For Jira Server/Data Center, create a Personal Access Token from your instance profile (Profile → Personal Access Tokens) instead.

### Option B: Direct REST API

If MCP is not available, use the Jira REST API v3 directly via `curl` or a helper script.

**Required environment variables:**

| Variable | Description |
|----------|-------------|
| `JIRA_URL` | Your Jira instance URL (e.g., `https://yourorg.atlassian.net`) |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | API token from id.atlassian.com |

Store these in your shell environment, secrets manager, or an untracked local env file. Do not commit them to the repo.

For direct `curl` examples, keep credentials out of command-line arguments by passing the Jira user config on stdin:

```bash
jira_curl() {
  printf 'user = "%s:%s"\n' "$JIRA_EMAIL" "$JIRA_API_TOKEN" |
    curl -s -K - "$@"
}
```

## MCP Tools Reference

When the jira-cli MCP server is configured, these core tools are available (30 core of 68 total; the full surface is documented in the jira-cli repo's `SERVICES.md`):

| Tool | Purpose | Example |
|------|---------|---------|
| `get_issue` | Fetch full issue details by key | `PROJ-1234` |
| `create_issue` | Create issues (Task, Bug, Story) | New bug report |
| `update_issue` | Update fields (summary, description, assignee) | Change assignee |
| `search_issues_jql` | JQL queries (GET, classic pagination) | `project = PROJ AND status = "In Progress"` |
| `search_issues_jql_post` | JQL queries (POST, cursor-based pagination) | Large result sets |
| `transition_issue` | Change status | Move to "In Review" |
| `get_issue_transitions` | List available transitions | Before transitioning |
| `add_comment` | Add comments | Progress update |
| `add_worklog` | Log work time | `2h 30m` |
| `get_sprint` | Sprint details | Active sprint review |
| `get_board_issues` | Issues on a board | Board review |
| `create_issue_link` | Link issues (Blocks, Relates to) | Dependency tracking |
| `get_remote_links` | Linked remote resources | Dev context |

> **Tip:** Always call `get_issue_transitions` before transitioning — transition IDs vary per project workflow.

## Direct REST API Reference

### Fetch a Ticket

```bash
jira_curl \
  -H "Content-Type: application/json" \
  "$JIRA_URL/rest/api/3/issue/PROJ-1234" | jq '{
    key: .key,
    summary: .fields.summary,
    status: .fields.status.name,
    priority: .fields.priority.name,
    type: .fields.issuetype.name,
    assignee: .fields.assignee.displayName,
    labels: .fields.labels,
    description: .fields.description
  }'
```

### Fetch Comments

```bash
jira_curl \
  -H "Content-Type: application/json" \
  "$JIRA_URL/rest/api/3/issue/PROJ-1234?fields=comment" | jq '.fields.comment.comments[] | {
    author: .author.displayName,
    created: .created[:10],
    body: .body
  }'
```

### Add a Comment

```bash
jira_curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "body": {
      "version": 1,
      "type": "doc",
      "content": [{
        "type": "paragraph",
        "content": [{"type": "text", "text": "Your comment here"}]
      }]
    }
  }' \
  "$JIRA_URL/rest/api/3/issue/PROJ-1234/comment"
```

### Transition a Ticket

```bash
# 1. Get available transitions
jira_curl \
  "$JIRA_URL/rest/api/3/issue/PROJ-1234/transitions" | jq '.transitions[] | {id, name: .name}'

# 2. Execute transition (replace TRANSITION_ID)
jira_curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"transition": {"id": "TRANSITION_ID"}}' \
  "$JIRA_URL/rest/api/3/issue/PROJ-1234/transitions"
```

### Search with JQL

```bash
jira_curl -G \
  --data-urlencode "jql=project = PROJ AND status = 'In Progress'" \
  "$JIRA_URL/rest/api/3/search"
```

## Analyzing a Ticket

When retrieving a ticket for development or test automation, extract:

### 1. Testable Requirements
- **Functional requirements** — What the feature does
- **Acceptance criteria** — Conditions that must be met
- **Testable behaviors** — Specific actions and expected outcomes
- **User roles** — Who uses this feature and their permissions
- **Data requirements** — What data is needed
- **Integration points** — APIs, services, or systems involved

### 2. Test Types Needed
- **Unit tests** — Individual functions and utilities
- **Integration tests** — API endpoints and service interactions
- **E2E tests** — User-facing UI flows
- **API tests** — Endpoint contracts and error handling

### 3. Edge Cases & Error Scenarios
- Invalid inputs (empty, too long, special characters)
- Unauthorized access
- Network failures or timeouts
- Concurrent users or race conditions
- Boundary conditions
- Missing or null data
- State transitions (back navigation, refresh, etc.)

### 4. Structured Analysis Output

```
Ticket: PROJ-1234
Summary: [ticket title]
Status: [current status]
Priority: [High/Medium/Low]
Test Types: Unit, Integration, E2E

Requirements:
1. [requirement 1]
2. [requirement 2]

Acceptance Criteria:
- [ ] [criterion 1]
- [ ] [criterion 2]

Test Scenarios:
- Happy Path: [description]
- Error Case: [description]
- Edge Case: [description]

Test Data Needed:
- [data item 1]
- [data item 2]

Dependencies:
- [dependency 1]
- [dependency 2]
```

## Updating Tickets

### When to Update

| Workflow Step | Jira Update |
|---|---|
| Start work | Transition to "In Progress" |
| Tests written | Comment with test coverage summary |
| Branch created | Comment with branch name |
| PR/MR created | Comment with link, link issue |
| Tests passing | Comment with results summary |
| PR/MR merged | Transition to "Done" or "In Review" |

### Comment Templates

**Starting Work:**
```
Starting implementation for this ticket.
Branch: feat/PROJ-1234-feature-name
```

**Tests Implemented:**
```
Automated tests implemented:

Unit Tests:
- [test file 1] — [what it covers]
- [test file 2] — [what it covers]

Integration Tests:
- [test file] — [endpoints/flows covered]

All tests passing locally. Coverage: XX%
```

**PR Created:**
```
Pull request created:
[PR Title](https://github.com/org/repo/pull/XXX)

Ready for review.
```

**Work Complete:**
```
Implementation complete.

PR merged: [link]
Test results: All passing (X/Y)
Coverage: XX%
```

## Security Guidelines

- **Never hardcode** Jira API tokens in source code or skill files
- **Always use** environment variables or a secrets manager
- **Add `.env`** to `.gitignore` in every project
- **Rotate tokens** immediately if exposed in git history
- **Use least-privilege** API tokens scoped to required projects
- **Validate** that credentials are set before making API calls — fail fast with a clear message

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | Invalid or expired API token | Regenerate at id.atlassian.com |
| `403 Forbidden` | Token lacks project permissions | Check token scopes and project access |
| `404 Not Found` | Wrong ticket key or base URL | Verify `JIRA_URL` and ticket key |
| `jira: command not found` | jira-cli binary not on PATH | Install from the repo `publish/` folder (or build from source) and add it to PATH |
| Connection timeout | Network/VPN issue | Check VPN connection and firewall rules |

## Best Practices

- Update Jira as you go, not all at once at the end
- Keep comments concise but informative
- Link rather than copy — point to PRs, test reports, and dashboards
- Use @mentions if you need input from others
- Check linked issues to understand full feature scope before starting
- If acceptance criteria are vague, ask for clarification before writing code
