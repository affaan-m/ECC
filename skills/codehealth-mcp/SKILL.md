---
name: codehealth-mcp
description: Real-time structural Code Health via CodeScene MCP — review before edits, verify score deltas after changes, gate commits and PRs. Use when reviewing code quality, refactoring, checking if AI changes degraded a file, or before commit/PR.
metadata:
  origin: community
---

# Code Health MCP (CodeScene)

Structural maintainability feedback for AI-assisted coding. Complements style/lint skills (`coding-standards`, `plankton-code-quality`) with **design-level** health scores and regression gates.

**Upstream:** [codescene-oss/codescene-mcp-server](https://github.com/codescene-oss/codescene-mcp-server)
**Package:** `@codescene/codehealth-mcp` (stdio via npx)

## Security and boundaries

**Opt-in (ECC):** The `codescene` block in `mcp-configs/mcp-servers.json` is a template only. ECC plugin installs do not auto-enable bundled MCP servers. Copy the entry into your config only if you want it. You can exclude it during ECC install/sync with `ECC_DISABLED_MCPS=codescene,...`.

**Credentials:** No bundled token. Set `CS_ACCESS_TOKEN` yourself (see [getting-a-personal-access-token.md](https://github.com/codescene-oss/codescene-mcp-server/blob/main/docs/getting-a-personal-access-token.md) in the upstream repo). Never commit tokens to the repo.

**What the tools read:** When invoked, tools analyze files and git state **in the local repository** you point them at (paths you pass, plus branch context for `analyze_change_set`). They do not run by themselves. For standalone mode, follow upstream privacy docs: [codescene-mcp-server README](https://github.com/codescene-oss/codescene-mcp-server#frequently-asked-questions) and [CodeScene policies](https://codescene.com/policies). Do not use this skill for secrets, credentials, or paths you do not want analyzed.

**If the MCP is unavailable (offline, bad token, server crash):** Do not invent Code Health scores. Tell the user the check was skipped. Continue only with explicit user approval. Prefer lint/tests/verification-loop for gating when MCP is down. Re-enable checks once the server connects.

## When to Use

- User asks to **review code quality**, **refactor** a file, or check if **AI changes degraded** maintainability
- Before editing a **hotspot**, legacy module, or unfamiliar file
- Before **commit** or **pull request** when you need a maintainability safeguard
- After a large agent-written diff — verify Code Health did not regress
- Pair with `verification-loop`, `tdd-workflow`, or `/quality-gate` as a structural check (not a replacement for tests/lint)

## When to Activate

Same triggers as **When to Use** above — this heading is what ECC uses for skill auto-activation.

## How It Works

### 1. Connect the MCP server

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

Token setup is documented in the upstream repo (link above). Standalone mode does not require a paid CodeScene platform account for the four tools listed below. Restart the session and confirm the `codescene` server is connected before relying on scores.

### 2. Call standalone tools only

| Tool | When to use |
|------|-------------|
| `code_health_review` | Full structural analysis **before** modifying a file |
| `code_health_score` | Quick numeric score after each change (delta check) |
| `pre_commit_code_health_safeguard` | Block commits that introduce Code Health regressions |
| `analyze_change_set` | Branch-level check **before** opening a PR |

Do **not** call platform-only tools (e.g. repository-wide technical debt hotspot lists). Do **not** reference `delta_analysis` — not available on standalone.

### 3. Interpret scores (1–10)

| Range | Meaning | Agent behavior |
|-------|---------|----------------|
| **9.0–10.0** | Green — healthy | Safer to extend; still prefer vertical slices |
| **4.0–8.9** | Yellow — debt | Tread carefully; no drive-by refactors |
| **1.0–3.9** | Red — severe debt | Narrow scope only |

### 4. Run the feedback loop

**Before touching a file**

1. Run `code_health_review` on the target path.
2. Record baseline score and listed code smells.
3. Plan the smallest change that addresses the task.

Scope by score: **below 5** — minimal diff only; **5–7** — no broad refactors; **above 7** — safer to refactor, still verify after each edit.

**After each change**

1. Run `code_health_score` on the same file.
2. Compare to the baseline from `code_health_review`.
3. If the score **regressed**, fix before continuing. Never mark the task done while the score is lower than when you started.

**Before every commit** — run `pre_commit_code_health_safeguard` on the repository path.

**Before a PR** — run `analyze_change_set` against the base branch (e.g. `main`).

## Examples

### Example: Flask maintainability improvement

On `pallets/flask`, an agent loop using only standalone tools:

1. `code_health_review` on a target module (baseline **4.82**)
2. Targeted refactor addressing listed smells
3. `code_health_score` after each edit
4. `pre_commit_code_health_safeguard` before commit
5. `analyze_change_set` before PR

Result: Code Health **4.82 → 9.1** (free standalone token only).

### Example: AGENTS.md enforcement block

Paste into the project `AGENTS.md` or `CLAUDE.md`:

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

### Example: anti-patterns vs correct loop

```markdown
# BAD: Edit first, check later
[large refactor without code_health_review]

# BAD: Ignore score drop
"Tests pass" → mark task done while Code Health decreased

# BAD: Broad refactor on red-score file (below 5)
Drive-by cleanup across the module

# GOOD: review → small change → score → commit safeguard → analyze_change_set
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

## Related Skills

- `coding-standards` — baseline conventions
- `plankton-code-quality` — write-time lint/format hooks
- `verification-loop` — build/test/lint gate
- `tdd-workflow` — test-first development
- `security-review` — security checklist
- `documentation-lookup` — library docs via Context7 (orthogonal)
