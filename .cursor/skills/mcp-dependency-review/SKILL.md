---
name: mcp-dependency-review
description: Statically review MCP configuration for mutable package references before approval or CI, without executing discovered MCP servers.
origin: ECC
---

# MCP Dependency Review

Use this skill to review MCP configuration for package references that can resolve to different code after the configuration itself was approved.

This is a **static review workflow**. Read configuration as text/JSON only. Do not execute discovered MCP server commands as part of the review.

## When to Activate

- Before approving a new or changed MCP configuration.
- When reviewing `.mcp.json`, `.github/mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, or equivalent workspace configuration.
- When adding a deterministic MCP configuration check to CI.
- When an MCP package reference uses `@latest`, a bare package name, or a version range.
- When a team wants to know whether a previously reviewed config can silently resolve to newer package code.

## Review Boundary

Default to the repository or workspace the user asked about. Do not inspect home-directory or machine-wide MCP configuration unless the user explicitly requests that broader scope.

Do not:

- run a `command` or `args` value found in MCP configuration;
- start an MCP server to confirm a static finding;
- install or resolve a referenced package merely to classify its version selector;
- copy credentials, headers, tokens, or secret values into the report;
- describe dependency mutability alone as proof of a vulnerability, compromise, or malicious package.

## Static Classification Rules

For npm/npx-style package selectors, classify the package reference itself:

| Selector | Result | Why |
| --- | --- | --- |
| `package@1.2.3` | SAFE | Exact semantic version is reproducible. |
| `package` | HIGH | A future resolution can select different package code. |
| `@scope/package` | HIGH | Scoped bare package is still mutable. |
| `package@latest` | HIGH | The selector is explicitly mutable. |
| `package@^1.2.0` | MEDIUM | Resolution can move within the range. |
| `package@~1.2.0` | MEDIUM | Resolution can move within the range. |
| wildcard / inequality / other range | MEDIUM | Selector permits more than one version. |
| local path / script / unknown binary | REVIEW | Package-version drift rules do not establish its update behavior. |

Treat `-y` / `--yes` only as context. It suppresses interactive confirmation; it is not a vulnerability by itself.

## Review Workflow

### 1. Locate repo-scoped configuration

Check only relevant workspace paths first, for example:

```text
.mcp.json
.github/mcp.json
.cursor/mcp.json
.vscode/mcp.json
.windsurf/mcp.json
```

Also inspect another MCP config path when the user names it explicitly.

### 2. Parse without executing

Read JSON or configuration text and identify each configured MCP server. For package-runner invocations such as `npx`, `npm exec`, `bunx`, `bun x`, `pnpm dlx`, or `yarn dlx`, isolate the package selector from command-line flags.

Never execute the discovered command to learn what it does.

### 3. Classify the selector

Apply the static classification table above. If the syntax is ambiguous, return REVIEW rather than guessing.

### 4. Recommend a reproducible fix

For mutable selectors, recommend an exact package version that the team has actually reviewed.

Do **not** invent a pin by substituting today's latest registry version. If the reviewed version is unknown, say so. A registry-history lookup is a separate network operation and should only be performed when the user asks for it.

### 5. Produce a bounded report

Use a compact table:

| Config | MCP server | Package/reference | Result | Why | Next step |
| --- | --- | --- | --- | --- | --- |

End with these boundaries:

- No MCP servers were executed during this review.
- Mutable dependency references are reproducibility/review signals, not breach claims.
- A clean result here is not a complete MCP security assessment.

## Example

Given:

```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": ["-y", "example-browser-mcp@latest"]
    }
  }
}
```

Report:

```text
.mcp.json | browser | example-browser-mcp@latest | HIGH
Reason: @latest can resolve to different package code later without a config diff.
Next: pin the exact version the team reviews and update it deliberately.
```

## Anti-Patterns

### Calling every mutable reference a vulnerability

**Wrong:** `@latest` means the MCP package is compromised.

**Better:** `@latest` means the configuration does not fully determine which package version will run later. Establish actual security impact separately.

### Pinning whatever is latest today

**Wrong:** replace a mutable selector with the current registry version and call the review fixed.

**Better:** pin a version the team has reviewed. If that evidence is unavailable, record the uncertainty.

### Expanding scope silently

**Wrong:** a repo review automatically scans user-level Claude, Cursor, or VS Code configuration.

**Better:** remain workspace-scoped unless machine-wide review is explicitly requested.

### Treating a clean drift review as complete MCP security

Exact dependency pins do not prove safe authorization, prompt-injection resistance, package provenance, secure implementation, or runtime isolation.

## Related Skills

- `mcp-server-patterns` — MCP server design, tools, resources, prompts, and transports.
- `security-review` — broader application-security checklist.
- `security-scan` — broader security scanning workflow.

## Further Reading

A public reference implementation and reproducible research methodology for this narrow review class are available in [MCP Drift Check](https://github.com/tomelias10/mcp-drift-check). The external project is optional; this ECC skill does not require it to perform the static review.
