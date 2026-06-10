# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 2.x / rc builds | :white_check_mark: |
| 1.10.x | :white_check_mark: |
| 1.9.x | Critical fixes only |
| < 1.9 | :x: |

Security fixes land on `main` first. Backports are best-effort and only for currently supported release lines.

## Reporting a Vulnerability

Use GitHub private vulnerability reporting whenever possible:

- <https://github.com/affaan-m/ECC/security/advisories/new>

You can also email **<security@ecc.tools>**.

Do **not** open a public GitHub issue for security vulnerabilities.

Include:

- affected file, package, version, commit, and install path
- steps to reproduce from a clean checkout
- expected impact and affected trust boundary
- whether exploitation requires local shell access, a malicious repo, a malicious package, a remote unauthenticated actor, or maintainer credentials
- any PoC logs with tokens, keys, local paths, and private data redacted

Expected response:

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 7 days
- **Critical fix or mitigation target:** within 14 days when the report affects a supported release and crosses a real trust boundary
- **Coordinated disclosure:** before public advisory publication

If a report is declined, we will explain whether it is not reproducible, out of scope, already fixed, or needs a stronger attack path.

## Scope

This policy covers:

- the `affaan-m/ECC` repository
- the `ecc-universal` npm package
- ECC plugin, install, repair, dashboard, hook, rule, skill, MCP, and command surfaces shipped from this repository
- GitHub Actions workflows and release automation in this repository
- the ECC Tools GitHub App integration points documented by this repository
- AgentShield usage docs when they are embedded here. AgentShield code issues belong in <https://github.com/affaan-m/agentshield>

## Official Distribution Surfaces

Official ECC surfaces are:

- GitHub repo: <https://github.com/affaan-m/ECC>
- npm package: `ecc-universal`
- GitHub App: <https://github.com/apps/ecc-tools>
- marketplace/plugin slug: `ecc@ecc`
- website: <https://ecc.tools>

Official AgentShield surface:

- npm package: `ecc-agentshield`
- GitHub repo: <https://github.com/affaan-m/agentshield>

The following packages have been observed using ECC repository metadata but are **not maintained by ECC**:

- `@chil_ntl/ecc-cli`
- `ecc-100xprompt-plugin`

Treat any package not listed under official surfaces as unofficial until verified. Do not install packages named `opencode-ecc`, `everything-claude-code`, or other ECC-like aliases unless this repository explicitly documents them as official.

GitHub dependency graph may also show Go module aliases such as `github.com/affaan-m/ecc` or historical repository paths. ECC is not currently distributed as a supported Go module.

## Out of Scope

Reports are usually out of scope when they only show:

- local command execution where the user already controls the local shell and no higher-privilege trust boundary is crossed
- screenshots, stale line numbers, or reports against `affaan-m/everything-claude-code` that do not reproduce on current `affaan-m/ECC`
- self-XSS or social engineering with no repository-controlled exploit path
- dependency graph/package metadata confusion without an install path to an official ECC package
- vulnerabilities in third-party packages unless ECC pins, installs, or executes them in a way that creates extra impact

Local developer tools can still be valid security issues when untrusted repository content, package installation, generated hooks, or CI automation can trigger execution without clear user intent. Show that trust boundary in the report.

## Supply-Chain Rules

ECC treats supply-chain exposure as a first-class security surface.

- GitHub Actions must use pinned commit SHAs for third-party actions.
- Workflows must avoid shelling untrusted GitHub context directly into `run:` blocks.
- Release and install docs must point only to official packages.
- Package metadata should point at `affaan-m/ECC`, not historical repo paths.
- Private vulnerability reports are triaged privately before public disclosure.
- Security advisories are published only when a supported release is affected and coordinated disclosure is appropriate.

## Operational Guidance

### Secrets Handling

`mcp-configs/mcp-servers.json` is a **template**. All `YOUR_*_HERE` values must be replaced at install time from env-vars or a secrets manager. Never commit real credentials. If a secret is accidentally committed, rotate it immediately and rewrite history. Do not rely on a plain revert.

The same rule applies to user-scope Claude Code config (`~/.claude/settings.json` or `%USERPROFILE%\.claude\settings.json`). That file is outside this repository, but it is commonly shared through `claude doctor` output, screenshots, and bug reports. Do not hardcode PATs, API keys, or OAuth tokens into `mcpServers[*].env` blocks. Resolve them at spawn time from the OS keychain or env-vars your MCP server already supports.

Quick audit:

```bash
# macOS / Linux
grep -EnH '(TOKEN|SECRET|KEY|PASSWORD)\s*"\s*:\s*"[A-Za-z0-9_-]{16,}"' ~/.claude/settings.json

# Windows PowerShell
Select-String -Path "$env:USERPROFILE\.claude\settings.json" -Pattern '(TOKEN|SECRET|KEY|PASSWORD)"\s*:\s*"[A-Za-z0-9_-]{16,}"'
```

If the audit matches, rotate the secret at the issuing provider, then move it out of the file.

### Local MCP Ports

Some bundled MCP servers connect over plain HTTP to a localhost port. Before first use, verify the listening process:

```bash
# Windows
netstat -ano | findstr :18801

# macOS / Linux
lsof -iTCP:18801 -sTCP:LISTEN
```

Compare the PID against the expected binary. Any other process on that port can intercept MCP traffic.

## Triage: suspicious `<system-reminder>` blocks

ECC runs inside agent harnesses that may inject ephemeral client-side system reminders into the model input on every turn. These blocks are not automatically repository-carried payloads.

Before treating one as an attack, verify:

1. Is the block actually in a file under this repo?

   ```bash
   grep -rEn "system-reminder|NEVER mention|DO NOT mention" .
   ```

2. Is the block stored in the session transcript as part of a tool result?
3. Is it consistent with known client reminders such as TodoWrite nudges, date notices, or file-modified notices?

Escalate upstream only when the block is present inside a tool result or repository file and is not attributable to the file, URL, or command that was actually read.

## Security Resources

- **AgentShield:** `npx ecc-agentshield scan`
- **Security Guide:** [The Shorthand Guide to Everything Agentic Security](./the-security-guide.md)
- **Supply-chain incident response:** [npm/GitHub Actions package-registry playbook](./docs/security/supply-chain-incident-response.md)
- **OWASP MCP Top 10:** <https://owasp.org/www-project-mcp-top-10/>
- **OWASP Agentic Applications Top 10:** <https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/>
