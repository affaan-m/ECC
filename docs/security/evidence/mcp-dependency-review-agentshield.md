# MCP Dependency Review — AgentShield Evidence

Generated for PR validation on 2026-09-25 using `ecc-agentshield@1.6.0`. Version 1.6.0 was already the published npm release when this evidence was generated; the reproduction command is pinned so a later publish cannot change the scanner code used.

Scope: `.agents/skills/mcp-dependency-review`

Command shape:

```bash
npx --yes ecc-agentshield@1.6.0 scan \
  --path .agents/skills/mcp-dependency-review \
  --format json \
  --evidence-pack <temporary-directory>
```

No active prompt-injection testing, sandbox execution, deep analysis, or auto-fix mode was enabled.

Result:

- AgentShield version: `1.6.0`
- AgentShield exit code: `0`
- files scanned: `1`
- security score: `100`
- grade: `A`
- SARIF findings: `0`

The committed SARIF is the redacted `agentshield-results.sarif` artifact produced by the evidence pack. AgentShield replaced the local scan root with `<target-path>`; no local username, absolute home path, credential, or token is included.
