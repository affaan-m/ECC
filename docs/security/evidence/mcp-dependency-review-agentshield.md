# MCP Dependency Review — AgentShield Evidence

Generated for PR validation on 2026-09-25 using ECC's published AgentShield CLI.

Scope: `.agents/skills/mcp-dependency-review`

Command shape:

```bash
npx --yes ecc-agentshield scan \
  --path .agents/skills/mcp-dependency-review \
  --format json \
  --evidence-pack <temporary-directory>
```

No active prompt-injection testing, sandbox execution, deep analysis, or auto-fix mode was enabled.

Result:

- AgentShield exit code: `0`
- files scanned: `1`
- security score: `100`
- grade: `A`
- SARIF findings: `0`

The committed SARIF is the redacted `agentshield-results.sarif` artifact produced by the evidence pack. AgentShield replaced the local scan root with `<target-path>`; no local username, absolute home path, credential, or token is included.
