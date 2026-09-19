---
tags: [ecc, jira, mcp, pr]
created: 2026-08-15
---

# PR — Use the jira-cli MCP server for `/ecc:jira` instead of mcp-atlassian

> Ready-to-use PR body. Goal: switch `/ecc:jira` from the `mcp-atlassian` MCP server (Python, `uvx`) to **jira-cli** (C#/.NET 8, single binary, 68 MCP tools) as the recommended MCP backend, while keeping the direct REST API fallback unchanged.

## Summary

- Replace the `jira` entry in `mcp-configs/mcp-servers.json` with the jira-cli MCP server (`jira mcp serve`).
- Update `commands/jira.md` and `skills/jira-integration/SKILL.md` to reference jira-cli tools and configuration.
- Keep the direct REST API fallback (Option B) untouched.
- No secrets or company URLs committed.

---

## 1. Current state (verified in this repo)

| File | Role | Detail |
|---|---|---|
| `commands/jira.md` | Slash command | 4 subcommands: `get`, `comment`, `transition`, `search`. Frontmatter: "Uses the jira-integration skill and MCP or REST API". |
| `skills/jira-integration/SKILL.md` | Supporting skill | MCP `mcp-atlassian` (recommended) or direct REST API v3 with `curl`. |
| `mcp-configs/mcp-servers.json` | MCP template | `jira` entry: `uvx mcp-atlassian==0.21.0`, env `JIRA_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` (placeholders only). |
| `manifests/install-modules.json` | Install manifest | Line 548: `skills/jira-integration` is part of an install module. |

## 2. Why jira-cli

Sources: product site <https://jira.lupala.com> and repo <https://github.com/LuPaLa-Coder/mcp_jira> (MIT, retrieved 2026-08-15).

- **Dual-mode CLI and MCP server** (stdio, JSON-RPC 2.0), C#/.NET 8, MIT license.
- **68 MCP tools overall**; 30 core tools documented in `SERVICES.md`: 10 issue management, 4 attachment, 7 project, 2 issue type, 3 status, 1 sprint, 1 user, 1 context, 1 field reference.
- **Jira Cloud (Basic Auth, REST v3 auto) and Server/Data Center (Bearer PAT, REST v2 auto)** with automatic API version selection per auth mode.
- **Multi-site**: `sites` map in config, `--site` override on tools, `JIRA_SITE` env var, `defaultSite`.
- **Single self-contained binary** per platform (`publish/mac/`, `publish/linux/`, `publish/windows/`) — zero runtime dependencies.
- **Compact, LLM-optimized output**; debug mode `jira --debug mcp serve` logs every HTTP call to stderr.

Advantages over `mcp-atlassian`: no Python/uvx runtime, static binary, larger tool surface (projects, attachments, sprints, fields, webhooks, admin), first-class Server/Data Center support, and multi-site switching.

## 3. Proposed changes

### 3.1 `mcp-configs/mcp-servers.json` — replace the `jira` entry

```json
{
  "jira": {
    "command": "jira",
    "args": ["mcp", "serve"],
    "description": "jira-cli MCP server — issues, projects, boards, sprints, users, fields, webhooks"
  }
}
```

> The binary is installed as `jira` on PATH (see install below); adapt the command to the platform binary path if needed. Credentials are NOT part of the server config — jira-cli reads them from `~/.config/jira-cli/config.json`.

### 3.2 `commands/jira.md`

- Update "Prerequisites → Option A (MCP Server)": point to jira-cli setup (install binary → `jira config add` → verify with `jira context` → `jira mcp serve`) instead of the `mcp-atlassian` template.
- Keep "Option B — Environment variables" (REST fallback) as-is.

### 3.3 `skills/jira-integration/SKILL.md`

- Rewrite the "Option A: MCP Server" section around jira-cli.
- Document installation (per-platform self-contained binaries, build from source, Docker).
- Document instance registration:

  ```bash
  # Jira Cloud (Basic Auth → REST v3 auto)
  jira config add --site myco \
    --url https://myco.atlassian.net \
    --email me@myco.com \
    --token ATATT3xFfGF0...

  # Jira Server/Data Center (Bearer PAT → REST v2 auto)
  jira config add --site eng \
    --url https://jira.eng.com/jira \
    --token <PersonalAccessToken> \
    --auth-mode bearer

  # Verify
  jira config list
  jira context
  ```

- Document the config file (`~/.config/jira-cli/config.json`, or `XDG_CONFIG_HOME`-relative; `jira config path` prints the location) with the schema: `sites`, `defaultSite`, `defaultApiVersion`, per-site `authMode` (`basic` | `bearer`), `apiVersion`, `defaultProjectKey`.
- Replace the "MCP Tools Reference" table with the jira-cli tool names (mapping below).
- Keep the direct REST API reference and the ticket-analysis workflow unchanged.

### 3.4 MCP tool mapping (`mcp-atlassian` → `jira-cli`)

| mcp-atlassian tool | jira-cli tool | Notes |
|---|---|---|
| `jira_search` | `search_issues_jql` (GET) / `search_issues_jql_post` (POST, cursor-based pagination) | `max_results` supported |
| `jira_get_issue` | `get_issue` | |
| `jira_create_issue` | `create_issue` | |
| `jira_update_issue` | `update_issue` | |
| `jira_transition_issue` | `transition_issue` | Check `get_issue_transitions` first (same guidance as today) |
| `jira_add_comment` | `add_comment` | |
| `jira_get_sprint_issues` | `get_sprint` + `search_issues_jql` | No exact equivalent among the 30 core tools — fetch sprint details, then issues by JQL (`sprint = X`) |
| `jira_create_issue_link` | `create_issue_link` | Part of the full 68-tool surface (not among the 30 core documented) |
| `jira_get_issue_development_info` | `get_remote_links` | Partial equivalent (remote links only, no branch/PR info) |
| (transitions lookup tip) | `get_issue_transitions` | Now a first-class tool instead of a tip |

Additional capabilities available after the switch (30 core): `add_worklog`, `get_issue_worklog`, `add_attachment`, `list_attachments`, `download_attachment`, `download_all_attachments`, `get_attachment_metadata`, `get_all_projects`, `get_project_statuses`, `get_project_types`, `get_project_roles`, `get_project_role`, `get_project_properties`, `get_project_features`, `get_issue_types`, `get_issue_type`, `get_statuses`, `get_status`, `get_status_categories`, `get_sprint`, `get_current_user`, `jira_context`, `get_fields`.

## 4. Client config examples (for users)

Server registration is the same shape everywhere (documented in `MCP-SETUP.md`):

```json
{
  "mcpServers": {
    "jira": {
      "command": "jira",
      "args": ["mcp", "serve"]
    }
  }
}
```

- **Claude Code**: project `.mcp.json` or `~/.claude.json` → `mcpServers`.
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) / `%APPDATA%\Claude\claude_desktop_config.json` (Windows).
- **GitHub Copilot CLI**: `~/.config/github-copilot/mcp-servers.json`.

## 5. Test plan

- [ ] TODO: install the binary (`chmod +x publish/mac/jira && sudo cp publish/mac/jira /usr/local/bin/` or equivalent platform) and verify `jira --version`.
- [ ] TODO: register the instance — `jira config add --site <name> --url <instance-url> ...` (Cloud) or `--auth-mode bearer` (Server/DC); verify with `jira context`.
- [ ] TODO: `/ecc:jira search "project = PROJ"` — summary table via `search_issues_jql`.
- [ ] TODO: `/ecc:jira get PROJ-123` — structured analysis (summary, acceptance criteria, dependencies) via `get_issue`.
- [ ] TODO: `/ecc:jira comment PROJ-123` — comment posted via `add_comment`.
- [ ] TODO: `/ecc:jira transition PROJ-123` — `get_issue_transitions`, then `transition_issue`.
- [ ] TODO: multi-site — same commands against a second site using `--site` / `JIRA_SITE` / `defaultSite`.
- [ ] TODO: Server/Data Center instance — Bearer PAT flow with automatic API version selection (v2).
- [ ] TODO: negative case — missing credentials → command stops and instructs the user (fail fast).
- [ ] TODO: REST fallback (Option B, `curl`) still works unchanged.

## 6. Security

- Credentials live in `~/.config/jira-cli/config.json` (local user config), never in the repo, `mcpServers` entries, or skill files.
- Least-privilege tokens: Cloud API token scoped to required projects; Server/DC PAT with minimal permissions and expiry.
- Rotate immediately if a token lands in git history.
- For self-hosted instances: verify TLS certificates and network exposure (VPN/allowlist).

## 7. Out of scope

- No real instance URLs or tokens committed.
- No changes to `manifests/install-modules.json` (the skill stays in its module).
- No removal of the REST API fallback.

## 8. Reviewer checklist

- [ ] No secrets or company URLs in the diff.
- [ ] `mcp-servers.json` `jira` entry replaced with `jira mcp serve` (no `uvx`/Python dependency).
- [ ] Skill MCP section rewritten with jira-cli install, config schema, multi-site, and Cloud/Server-DC auth.
- [ ] Tool mapping table covers every `jira_*` tool referenced by the command and skill.
- [ ] Test plan is executable (TODOs can be checked off during functional review).
- [ ] Existing Cloud users can keep their current setup (documented migration path).
