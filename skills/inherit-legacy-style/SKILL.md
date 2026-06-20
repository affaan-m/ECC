---
name: inherit-legacy-style
description: Legacy-project style inheritance skill. Use when the user types /inherit-legacy-style, or when onboarding an AI coding agent onto a hand-written legacy project and you need to prevent "style drift" (the model imposing its pretrained mainstream idioms onto the project). Language- and framework-agnostic — it aligns meta-architecture only, not syntax. Once run, it becomes a behavioral constraint on all subsequent coding tasks. Do NOT use for pure research or one-off questions unrelated to code-style alignment.
metadata:
  origin: community
allowed-tools: Read, Glob, Grep, Bash, Edit, Write, AskUserQuestion
---

# Inherit Legacy Style

Prevents AI code style drift in legacy projects by scanning the codebase for implicit conventions across 4 meta-architecture dimensions, resolving conflicts with the user one at a time, and crystallizing the consensus into an enforceable `.ai-style-rules.md`. Fully language- and framework-agnostic.

## When to Activate

- User types `/inherit-legacy-style`
- User mentions onboarding AI onto a hand-written legacy project
- User is worried about AI-generated code "drifting" from existing project conventions
- User wants to extract and codify their project's implicit coding rules

## When to Use

Use this skill when you need to preserve legacy project style and prevent AI-generated style drift. See **When to Activate** above for trigger conditions.

## Prerequisites

- Git (recommended; non-Git projects fall back to file timestamps for incremental mode)
- Read/Write access to the project root (generates `.ai-style-rules.md` and optionally `CLAUDE.md`)

## Workflow

### Step 0 — Auto-Detect Mode

Silently check for `.ai-style-rules.md` at the project root:

| File exists? | Mode |
|---|---|
| No | **Branch A — First-time Full-Scan** |
| Yes | **Branch B — Incremental Sniff** |

Announce the mode in one line and proceed — never ask the user to pick.

### Branch A — First-time Full-Scan

**1. Measure scale, pick a scanning tier**

```bash
git ls-files | grep -cE '\.(js|ts|jsx|tsx|vue|py|go|rs|java|kt|rb|php|cs|swift|c|cpp|h)$'
```

| Tier | Source files | Strategy |
|---|---|---|
| Small | ≲ 50 | Full close-read every source |
| Medium | 50–500 | Infra layer = full read; business layer = sample 2–3 per dimension |
| Large | ≳ 500 | Strict sampling + budget cap; `--stat` summary first, then targeted reads |

**2. Scan along 4 dimensions**

1. **File Anatomy** — in-file declaration order (imports → types → main logic → helpers → export)
2. **State & Control Flow** — naming conventions for async state, pagination, flags
3. **Infrastructure** — where cross-cutting utils live (interceptors, formatters, middleware)
4. **Error Handling** — try/catch vs global interceptor vs Result return; null-check habits

**3. Apply signal-threshold noise reduction**

Before interrupting the user, evaluate signal strength:

- **Weak signal** → auto-suppress: minority <5% AND count <10 → majority wins, minority goes to DONTs
- **Strong signal** → grill: near-even split, or semantic fork on a core dimension
- **Small-project exception**: sources ≲50, "3 vs 2" is NOT a majority → grill it

**4. Resolve conflicts one at a time (Grilling Protocol)**

For each strong-signal conflict, present exactly ONE question with 4 options:

> Evidence: `pathA` uses style X, `pathB` uses style Y
> WARNING: Risk: mixing both fractures the project style
> Choose: `1` follow X  `2` follow Y  `3` this is evolution, update rules  `4` I have a new rule

Suspend until the user answers, then proceed to the next conflict. Never stack questions.

**5. Generate `.ai-style-rules.md`** with three mandatory sections:
- **[Golden Files]** — real exemplar paths annotated with what they demonstrate
- **[Naming & State-Control Rules]** — concrete, checkable conventions
- **[DONTs]** — anti-patterns that must not propagate

**6. Install the persistent hook**

Ask the user for enforcement strength (use `AskUserQuestion`):

| Option | Mechanism |
|---|---|
| **1** Soft hook (recommended) | Write `@.ai-style-rules.md` reference into project `CLAUDE.md` |
| **2** Hard hook | Soft hook + `PreToolUse[Write\|Edit\|MultiEdit]` Hook in `settings.json` |
| **3** No hook | Keep the rules file; user references manually |

### Branch B — Incremental Sniff

1. Read existing `.ai-style-rules.md`; if it has a commit fingerprint, `git diff <last_hash> HEAD --stat` to pinpoint delta
2. Read recent Git changes (`git log -3 --stat` → inspect suspect files on demand)
3. For oversized diffs (>hundreds of files): `--stat` summary only + sample the largest changes
4. Compare new code against recorded rules → conflicts go through Grilling Protocol
5. Append evolution log at the end of `.ai-style-rules.md` (never overwrite old rules)

### Per-Turn Enforcement

When `.ai-style-rules.md` is in context (loaded via CLAUDE.md), every code-writing task must open with a **compliance declaration** in the reasoning chain, naming the exemplar being followed and the DONTs being avoided.

## How It Works

This skill auto-detects whether it's a first-time or incremental run via `.ai-style-rules.md` presence:

- **First-time (Branch A)** — Measures project scale, scans codebase across 4 meta-architecture dimensions (File Anatomy, State & Control Flow, Infrastructure, Error Handling), applies signal-threshold noise reduction to suppress weak conflicts, resolves strong-signal conflicts one-at-a-time with the user, generates `.ai-style-rules.md` with Golden Files / Naming Rules / DONTs, and offers optional enforcement hooks.
- **Incremental (Branch B)** — Reads existing rules, checks recent Git diffs for new or conflicting patterns, runs the same one-at-a-time grilling protocol for any conflicts found, and appends evolution logs without overwriting existing rules.
- **Per-Turn Enforcement** — When hooked via `CLAUDE.md`, every code-writing task opens with a compliance declaration naming the exemplar followed and the DONTs avoided.

## Output Specification

- `.ai-style-rules.md` at project root (with commit fingerprint + scale tier in header)
- Optionally `CLAUDE.md` with `@.ai-style-rules.md` reference
- Evolution logs appended as `### [YYYY-MM-DD] Style Evolution Log` entries

## Anti-Patterns

- FAIL: Do NOT skip the scale measurement step — sampling a 30-file project "starves" it; full-scanning a 5,000-file repo blows up
- FAIL: Do NOT stack multiple conflict questions at once — grilling is strictly one-at-a-time
- FAIL: Do NOT overwrite old rules in incremental mode — always append evolution logs
- FAIL: Do NOT default to "hard hook" without asking — enforcement strength is the user's call
- FAIL: Do NOT judge syntax or tech-stack quality — this skill aligns meta-architecture only
- FAIL: Do NOT copy bugs from exemplar files — reuse structure, flag defects

## Best Practices

- Announce the detected mode (first-time vs incremental) and scale tier in one line before scanning
- For large projects, read `--stat` summaries first, then targeted `Read` on suspect files
- Let the signal threshold handle noise — a 843-vs-8 naming split should auto-resolve without user interruption
- When in doubt about signal strength, lean toward asking
- The CLAUDE.md soft hook (`@.ai-style-rules.md`) is usually sufficient; hard hook only if the user wants mechanical enforcement

## Related Skills

- `init` — initialize a new CLAUDE.md with codebase documentation
- `code-review` — review diffs for correctness and style issues
- `simplify` — review code for reuse and simplification opportunities

## Examples

1. **First-time onboarding**
   - User: "Help me onboard AI to this older codebase without changing its style."
   - Action: Run Branch A full-scan → measure scale → scan 4 dimensions → grill conflicts → generate `.ai-style-rules.md` → offer hook strength (soft/hard/none).

2. **Incremental update after team changes**
   - User: "We added a new module; keep existing style rules intact."
   - Action: Run Branch B incremental sniff → compare Git deltas to recorded rules → grill any new conflicts → append evolution log without overwriting.

3. **Enforcing DONTs via CLAUDE.md**
   - User: "Make sure all new code stays consistent with the project's rules."
   - Action: Soft hook installed → `.ai-style-rules.md` auto-loaded every session → every code-writing task opens with compliance declaration, reusing exemplar patterns and avoiding DONTs.
