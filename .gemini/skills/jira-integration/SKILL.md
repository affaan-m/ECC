---
name: jira-integration
description: Use this skill when retrieving Jira tickets, analyzing requirements, updating ticket status, adding comments, or transitioning issues. Provides Jira API patterns via MCP or direct REST calls.
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

Install the `mcp-atlassian` MCP server. This exposes Jira tools directly to your AI agent.

**Requirements:**
- Python 3.10+
- `uvx` (from `uv`), installed via your package manager or the official `uv` installation documentation

**Add to your MCP config** (e.g., `~/.claude.json` → `mcpServers`):

```json
{
  "jira": {
    "command": "uvx",
    "args": ["mcp-atlassian==0.21.0"],
    "env": {
      "JIRA_URL": "https://YOUR_ORG.atlassian.net",
      "JIRA_EMAIL": "your.email@example.com",
      "JIRA_API_TOKEN": "your-api-token"
    },
    "description": "Jira issue tracking — search, create, update, comment, transition"
  }
}
```

> **Security:** Never hardcode secrets. Prefer setting `JIRA_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` in your system environment (or a secrets manager). Only use the MCP `env` block for local, uncommitted config files.

**To get a Jira API token:**
1. Go to <https://id.atlassian.com/manage-profile/security/api-tokens>
2. Click **Create API token**
3. Copy the token — store it in your environment, never in source code

### Option B: Direct REST API

If MCP is not available, use the Jira REST API v3 directly via `curl` or a helper script.

**Required environment variables:**

| Variable | Description |
|----------|-------------|
| `JIRA_URL` | Your Jira instance URL (e.g., `https://yourorg.atlassian.net`) |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | API token from id.atlassian.com |

Store these in your shell environment, secrets manager, or an untracked local env file. Do not commit them to the repo.

## MCP Tools Reference

When the `mcp-atlassian` MCP server is configured, these tools are available:

| Tool | Purpose | Example |
|------|---------|---------|
| `jira_search` | JQL queries | `project = PROJ AND status = "In Progress"` |
| `jira_get_issue` | Fetch full issue details by key | `PROJ-1234` |
| `jira_create_issue` | Create issues (Task, Bug, Story, Epic) | New bug report |
| `jira_update_issue` | Update fields (summary, description, assignee) | Change assignee |
| `jira_transition_issue` | Change status | Move to "In Review" |
| `jira_add_comment` | Add comments | Progress update |
| `jira_get_sprint_issues` | List issues in a sprint | Active sprint review |
| `jira_create_issue_link` | Link issues (Blocks, Relates to) | Dependency tracking |
| `jira_get_issue_development_info` | See linked PRs, branches, commits | Dev context |

> **Tip:** Always call `jira_get_transitions` before transitioning — transition IDs vary per project workflow.

## Direct REST API Reference

### Fetch a Ticket

```bash
curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
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
curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  "$JIRA_URL/rest/api/3/issue/PROJ-1234?fields=comment" | jq '.fields.comment.comments[] | {
    author: .author.displayName,
    created: .created[:10],
    body: .body
  }'
```

### Add a Comment

```bash
curl -s -X POST -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
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
curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "$JIRA_URL/rest/api/3/issue/PROJ-1234/transitions" | jq '.transitions[] | {id, name: .name}'

# 2. Execute transition (replace TRANSITION_ID)
curl -s -X POST -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"transition": {"id": "TRANSITION_ID"}}' \
  "$JIRA_URL/rest/api/3/issue/PROJ-1234/transitions"
```

### Search with JQL

```bash
curl -s -G -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
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
| `spawn uvx ENOENT` | IDE cannot find `uvx` on PATH | Use full path (e.g., `~/.local/bin/uvx`) or set PATH in `~/.zprofile` |
| Connection timeout | Network/VPN issue | Check VPN connection and firewall rules |

## Best Practices

- Update Jira as you go, not all at once at the end
- Keep comments concise but informative
- Link rather than copy — point to PRs, test reports, and dashboards
- Use @mentions if you need input from others
- Check linked issues to understand full feature scope before starting
- If acceptance criteria are vague, ask for clarification before writing code
