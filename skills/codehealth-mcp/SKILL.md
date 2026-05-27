---
name: codehealth-mcp
description: Real-time structural Code Health via CodeScene MCP — review before edits, verify score deltas after changes, gate commits and PRs. Use when reviewing code quality, refactoring, checking if AI changes degraded a file, or before commit/PR.
origin: community
---

# Code Health MCP (CodeScene)

Structural maintainability feedback for AI-assisted coding. Complements style/lint skills (`coding-standards`, `plankton-code-quality`) with **design-level** health scores and regression gates.

**Product:** [CodeScene Code Health MCP](https://codescene.com/product/code-health-mcp)  
**Package:** `@codescene/codehealth-mcp` (stdio via npx)

## When to Activate

- User asks to **review code quality**, **refactor** a file, or check if **AI changes degraded** maintainability
- Before editing a **hotspot**, legacy module, or unfamiliar file
- Before **commit** or **pull request** when you need a maintainability safeguard
- After a large agent-written diff — verify Code Health did not regress
- Pair with `verification-loop`, `tdd-workflow`, or `/quality-gate` as a structural check (not a replacement for tests/lint)

## MCP setup

### 1. Enable the server

Copy the `codescene` entry from `mcp-configs/mcp-servers.json` into your harness MCP config.

**Claude Code** (`~/.claude.json` → `mcpServers`):

```json
"codescene": {
  "command": "npx",
  "args": ["-y", "@codescene/codehealth-mcp"],
  "env": {
    "CS_ACCESS_TOKEN": "YOUR_CS_ACCESS_TOKEN_HERE"
  }
}
```

**Project-scoped:** merge the same block into `.mcp.json` at the repo root.

### 2. Standalone token (free)

Get a token from [codescene.com/product/code-health-mcp](https://codescene.com/product/code-health-mcp).  
No paid CodeScene platform account required for the tools below.

Restart the session and confirm the `codescene` MCP server is connected before calling tools.

## Standalone tools only (no paid account)

| Tool | When to use |
|------|-------------|
| `code_health_review` | Full structural analysis **before** modifying a file |
| `code_health_score` | Quick numeric score after each change (delta check) |
| `pre_commit_code_health_safeguard` | Block commits that introduce Code Health regressions |
| `analyze_change_set` | Branch-level check **before** opening a PR |

Do **not** call platform-only tools (e.g. repository-wide technical debt hotspot lists). Do **not** reference `delta_analysis` — not available on standalone.

## Code Health scores (1–10)

| Range | Meaning | Agent behavior |
|-------|---------|----------------|
| **9.0–10.0** | Green — healthy | Safer to extend; still prefer vertical slices |
| **4.0–8.9** | Yellow — debt | Tread carefully; no drive-by refactors |
| **1.0–3.9** | Red — severe debt | Narrow scope only |

## Workflow

### Before touching a file

1. Run `code_health_review` on the target path.
2. Record baseline score and listed code smells.
3. Plan the smallest change that addresses the task.

**Scope by score:**

- **Below 5** — Problematic: minimal diff only; no broad refactors.
- **5–7** — Warning: fix what you came for; do not expand scope.
- **Above 7** — Safer to refactor; still verify after each edit.

### After each change

1. Run `code_health_score` on the same file.
2. Compare to the baseline from `code_health_review`.
3. If the score **regressed**, fix before continuing. Never mark the task done while the score is lower than when you started.

### Before every commit

Run `pre_commit_code_health_safeguard` on the repository path. If gates fail, fix degradations before committing.

### Before a PR

Run `analyze_change_set` against the base branch (e.g. `main`). Resolve file-level degradations before opening the PR.

## AGENTS.md / CLAUDE.md block

Paste into the project agent instructions:

```md
## Code Health (CodeScene MCP)

Before modifying any file: run `code_health_review`, note score and issues.

- Score below 5: problematic range — scope changes narrowly.
- Score 5–7: warning range — no broad refactors.

After each change: run `code_health_score` to verify delta.

- If score regressed: fix before continuing; never declare done if score dropped.

Before every commit: run `pre_commit_code_health_safeguard`.

Before PR: run `analyze_change_set`.
```

## Pairing with ECC

| ECC skill / flow | Code Health MCP role |
|------------------|----------------------|
| `coding-standards` | Style/naming; Code Health = structure/complexity |
| `plankton-code-quality` | Write-time lint/format; Code Health = pre/post edit structural gate |
| `verification-loop` / `/quality-gate` | Add structural regression check before "done" |
| `security-review` | Security vs maintainability — use both when relevant |
| `tdd-workflow` | Tests pass ≠ healthy design — check score after refactors |

**Context tip:** ECC recommends keeping MCP count low. Enable `codescene` when doing substantive edits; disable when not needed.

## Anti-patterns

```markdown
# BAD: Edit first, check later
[large refactor without code_health_review]

# BAD: Ignore score drop
"Tests pass" → mark task done while Code Health decreased

# BAD: Broad refactor on red-score file (below 5)
Drive-by cleanup across the module

# GOOD: review → small change → score → commit safeguard → analyze_change_set
```

## Example outcome

On `pallets/flask`, review → targeted refactor → score verification improved Code Health from **4.82 → 9.1** using only standalone MCP tools (free token).

## Related Skills

- `coding-standards` — baseline conventions
- `plankton-code-quality` — write-time lint/format hooks
- `verification-loop` — build/test/lint gate
- `tdd-workflow` — test-first development
- `security-review` — security checklist
- `documentation-lookup` — library docs via Context7 (orthogonal)
