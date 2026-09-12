---
name: plankton-code-quality
description: "Write-time code quality enforcement using Plankton — auto-formatting, linting, and Claude-powered fixes on every file edit via hooks. Use when setting up write-time formatting, linting, or auto-fix hooks on file edits."
metadata:
  origin: community
---

# Plankton Code Quality Skill

Integration reference for Plankton (credit: @alxfazio), a write-time code quality enforcement system for Claude Code. Plankton runs formatters and linters on every file edit via PostToolUse hooks, then spawns Claude subprocesses to fix violations the agent didn't catch.

## When to Use

- You want automatic formatting and linting on every file edit (not just at commit time)
- You need defense against agents modifying linter configs to pass instead of fixing code
- You want tiered model routing for fixes (Haiku for simple style, Sonnet for logic, Opus for types)
- You work with multiple languages (Python, TypeScript, Shell, YAML, JSON, TOML, Markdown, Dockerfile)

## How It Works

### Three-Phase Architecture

Every time Claude Code edits or writes a file, Plankton's `multi_linter.sh` PostToolUse hook runs:

```
Phase 1: Auto-Format (Silent)
├─ Runs formatters (ruff format, biome, shfmt, taplo, markdownlint)
├─ Fixes 40-50% of issues silently
└─ No output to main agent

Phase 2: Collect Violations (JSON)
├─ Runs linters and collects unfixable violations
├─ Returns structured JSON: {line, column, code, message, linter}
└─ Still no output to main agent

Phase 3: Delegate + Verify
├─ Spawns claude -p subprocess with violations JSON
├─ Routes to model tier based on violation complexity:
│   ├─ Haiku: formatting, imports, style (E/W/F codes) — 120s timeout
│   ├─ Sonnet: complexity, refactoring (C901, PLR codes) — 300s timeout
│   └─ Opus: type system, deep reasoning (unresolved-attribute) — 600s timeout
├─ Re-runs Phase 1+2 to verify fixes
└─ Exit 0 if clean, Exit 2 if violations remain (reported to main agent)
```

### What the Main Agent Sees

| Scenario | Agent sees | Hook exit |
|----------|-----------|-----------|
| No violations | Nothing | 0 |
| All fixed by subprocess | Nothing | 0 |
| Violations remain after subprocess | `[hook] N violation(s) remain` | 2 |
| Advisory (duplicates, old tooling) | `[hook:advisory] ...` | 0 |

The main agent only sees issues the subprocess couldn't fix. Most quality problems are resolved transparently.

### Config Protection (Defense Against Rule-Gaming)

LLMs will modify `.ruff.toml` or `biome.json` to disable rules rather than fix code. Plankton blocks this with three layers:

1. **PreToolUse hook** — `protect_linter_configs.sh` blocks edits to all linter configs before they happen
2. **Stop hook** — `stop_config_guardian.sh` detects config changes via `git diff` at session end
3. **Protected files list** — `.ruff.toml`, `biome.json`, `.shellcheckrc`, `.yamllint`, `.hadolint.yaml`, and more

### Package Manager Enforcement

A PreToolUse hook on Bash blocks legacy package managers:
- `pip`, `pip3`, `poetry`, `pipenv` → Blocked (use `uv`)
- `npm`, `yarn`, `pnpm` → Blocked (use `bun`)
- Allowed exceptions: `npm audit`, `npm view`, `npm publish`

## Setup

### Quick Start

> **Note:** Plankton requires manual installation from its repository. Review the code before installing.

```bash
# Install core dependencies
brew install jaq ruff uv

# Install Python linters
uv sync --all-extras

# Start Claude Code — hooks activate automatically
claude
```

No install command, no plugin config. The hooks in `.claude/settings.json` are picked up automatically when you run Claude Code in the Plankton directory.

### Per-Project Integration

To use Plankton hooks in your own project:

1. Copy `.claude/hooks/` directory to your project
2. Copy `.claude/settings.json` hook configuration
3. Copy linter config files (`.ruff.toml`, `biome.json`, etc.)
4. Install the linters for your languages

### Language-Specific Dependencies

| Language | Required | Optional |
|----------|----------|----------|
| Python | `ruff`, `uv` | `ty` (types), `vulture` (dead code), `bandit` (security) |
| TypeScript/JS | `biome` | `oxlint`, `semgrep`, `knip` (dead exports) |
| Shell | `shellcheck`, `shfmt` | — |
| YAML | `yamllint` | — |
| Markdown | `markdownlint-cli2` | — |
| Dockerfile | `hadolint` (>= 2.12.0) | — |
| TOML | `taplo` | — |
| JSON | `jaq` | — |

## Pairing with ECC

### Complementary, Not Overlapping

| Concern | ECC | Plankton |
|---------|-----|----------|
| Code quality enforcement | PostToolUse hooks (Prettier, tsc) | PostToolUse hooks (20+ linters + subprocess fixes) |
| Security scanning | AgentShield, security-reviewer agent | Bandit (Python), Semgrep (TypeScript) |
| Config protection | — | PreToolUse blocks + Stop hook detection |
| Package manager | Detection + setup | Enforcement (blocks legacy PMs) |
| CI integration | — | Pre-commit hooks for git |
| Model routing | Manual (`/model opus`) | Automatic (violation complexity → tier) |

### Recommended Combination

1. Install ECC as your plugin (agents, skills, commands, rules)
2. Add Plankton hooks for write-time quality enforcement
3. Use AgentShield for security audits
4. Use ECC's verification-loop as a final gate before PRs

### Avoiding Hook Conflicts

If running both ECC and Plankton hooks:
- ECC's Prettier hook and Plankton's biome formatter may conflict on JS/TS files
- Resolution: disable ECC's Prettier PostToolUse hook when using Plankton (Plankton's biome is more comprehensive)
- Both can coexist on different file types (ECC handles what Plankton doesn't cover)

## Configuration Reference

Plankton's `.claude/hooks/config.json` controls all behavior:

```json
{
  "languages": {
    "python": true,
    "shell": true,
    "yaml": true,
    "json": true,
    "toml": true,
    "dockerfile": true,
    "markdown": true,
    "typescript": {
      "enabled": true,
      "js_runtime": "auto",
      "biome_nursery": "warn",
      "semgrep": true
    }
  },
  "phases": {
    "auto_format": true,
    "subprocess_delegation": true
  },
  "subprocess": {
    "tiers": {
      "haiku":  { "timeout": 120, "max_turns": 10 },
      "sonnet": { "timeout": 300, "max_turns": 10 },
      "opus":   { "timeout": 600, "max_turns": 15 }
    },
    "volume_threshold": 5
  }
}
```

**Key settings:**
- Disable languages you don't use to speed up hooks
- `volume_threshold` — violations > this count auto-escalate to a higher model tier
- `subprocess_delegation: false` — skip Phase 3 entirely (just report violations)

## Environment Overrides

| Variable | Purpose |
|----------|---------|
| `HOOK_SKIP_SUBPROCESS=1` | Skip Phase 3, report violations directly |
| `HOOK_SUBPROCESS_TIMEOUT=N` | Override tier timeout |
| `HOOK_DEBUG_MODEL=1` | Log model selection decisions |
| `HOOK_SKIP_PM=1` | Bypass package manager enforcement |

## References

- Plankton (credit: @alxfazio)
- Plankton REFERENCE.md — Full architecture documentation (credit: @alxfazio)
- Plankton SETUP.md — Detailed installation guide (credit: @alxfazio)

## ECC v1.8 Additions

### Copyable Hook Profile

Set strict quality behavior:

```bash
export ECC_HOOK_PROFILE=strict
export ECC_QUALITY_GATE_FIX=true
export ECC_QUALITY_GATE_STRICT=true
```

### Language Gate Table

- TypeScript/JavaScript: Biome preferred, Prettier fallback
- Python: Ruff format/check
- Go: gofmt

### Config Tamper Guard

During quality enforcement, flag changes to config files in same iteration:

- `biome.json`, `.eslintrc*`, `prettier.config*`, `tsconfig.json`, `pyproject.toml`

If config is changed to suppress violations, require explicit review before merge.

### CI Integration Pattern

Use the same commands in CI as local hooks:

1. run formatter checks
2. run lint/type checks
3. fail fast on strict mode
4. publish remediation summary

### Health Metrics

Track:
- edits flagged by gates
- average remediation time
- repeat violations by category
- merge blocks due to gate failures

---

## Gabe's addition: oxlint complexity + ratchet ceiling (JS/TS)

Closes the JS/TS gap in the model-routing table above. Python complexity (ruff C901,
PLR) already routes to Sonnet. JS/TS had no equivalent rule turned on by default.

### Turn on oxlint's `complexity` rule, Required not Optional

oxlint's `complexity` rule (source: eslint's `complexity` rule, ported) lives in the
"restriction" category, which oxlint does not enable by default. It must be turned on
by hand. Verified against https://oxc.rs/docs/guide/usage/linter/rules/eslint/complexity
(2026-08-27): default option is `max: 20`.

In the skill's Language-Specific Dependencies table, `oxlint` is listed as Optional for
TypeScript/JS. For the `complexity` rule specifically, that changes to Required. Add to
`.oxlintrc.json`:

```json
{
  "rules": {
    "complexity": ["error", { "max": 20 }]
  }
}
```

20 is oxlint's own default and the starting ceiling. See the ratchet section below for
how the ceiling actually gets set on a real codebase.

### Model-routing row

Add oxlint `complexity` violations to the same row as the existing Python entry in the
Phase 3 subprocess table:

```
├─ Sonnet: complexity, refactoring (C901, PLR codes, oxlint complexity), 300s timeout
```

Same tier as Python's C901/PLR. A complexity violation is a refactoring job either way,
language does not change the model tier.

### The ratchet-ceiling technique

Source: https://github.com/modem-dev/hunk/pull/861 (merged 2026-08-26, verified against
the PR's own diff and description via the GitHub API, not paraphrased from memory). Hunk
turned on oxlint's `complexity` rule with `"error", { "max": 80 }` in `.oxlintrc.json`.
Their own worst score at the time was 78 (`App`), next was 76
(`validateFileViewLayout`). From the PR body: "This is intentionally an initial
regression ceiling rather than the long-term target... so 80 adds enforcement without
grandfathering or suppressions. The ceiling can be ratcheted downward as existing
hotspots are simplified." And: "A global ceiling does not prevent a function below 80
from growing toward it."

The technique, as actually run in that PR:

1. Measure the current worst complexity score in the codebase (oxlint reports it when
   the rule fires).
2. Set the ENFORCED ceiling to that worst score, not to oxlint's own default of 20. Add
   a couple points of headroom if needed so the initial enable does not fail CI on a
   score you haven't fixed yet (hunk used 80 against a worst of 78).
3. Commit that as `"error"`, wired into the existing lint CI step. This is a real gate
   from the first commit, not a suggestion.
4. Never grandfather. The ceiling is global. A function sitting at 40 today is not
   exempt, it still cannot cross the ceiling later. That is the whole point: catch
   growth, not just today's worst offenders.
5. Never blanket-suppress. No per-file or per-function disable comments to make a
   violation go away. Fix it or leave it under the ceiling.
6. Each time a flagged hotspot actually gets refactored below the ceiling, lower the
   ceiling by hand to lock the improvement in. This is a manual step done as its own
   commit, not automated. It is how the ceiling moves toward the linter's real default
   of 20 over time instead of sitting at the codebase's worst score forever.

One caveat, stated plainly: the PR itself went straight from "rule off" to `"error"`
enforcement in one commit. It did not stage through a report-only or warn-only phase
first. Starting with the rule set to `"warn"` for one CI run before flipping it to
`"error"` is a reasonable staging step if a team has never measured its own worst score
and does not want a surprise CI failure, but that staging step is Gabe's own prudent
practice, not something verified in hunk's PR. Say so if you use it, do not attribute it
to the source.
