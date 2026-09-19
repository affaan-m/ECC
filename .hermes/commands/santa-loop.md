---
description: Adversarial dual-review convergence loop — two independent model reviewers must both approve before code ships.
---

# Santa Loop

Adversarial dual-review convergence loop using the santa-method skill. Two independent reviewers — different models, no shared context — must both return NICE before code ships.

## Purpose

Run two independent reviewers (Claude Opus + an external model) against the current task output. Both must return NICE before the code is pushed. If either returns NAUGHTY, fix all flagged issues, commit, and re-run fresh reviewers — up to 3 rounds.

## Usage

```
/santa-loop [file-or-glob | description]
```

## Workflow

### Step 1: Identify What to Review

Determine the scope from `$ARGUMENTS` or fall back to uncommitted changes:

```bash
git diff --name-only HEAD
```

Read all changed files to build the full review context. If `$ARGUMENTS` specifies a path, file, or description, use that as the scope instead.

### Step 2: Build the Rubric

Construct a rubric appropriate to the file types under review. Every criterion must have an objective PASS/FAIL condition. Include at minimum:

| Criterion | Pass Condition |
|-----------|---------------|
| Correctness | Logic is sound, no bugs, handles edge cases |
| Security | No secrets, injection, XSS, or OWASP Top 10 issues |
| Error handling | Errors handled explicitly, no silent swallowing |
| Completeness | All requirements addressed, no missing cases |
| Internal consistency | No contradictions between files or sections |
| No regressions | Changes don't break existing behavior |

Add domain-specific criteria based on file types (e.g., type safety for TS, memory safety for Rust, migration safety for SQL).

### Step 3: Dual Independent Review

Launch two reviewers **in parallel** using the Agent tool (both in a single message for concurrent execution). Both must complete before proceeding to the verdict gate.

Each reviewer evaluates every rubric criterion as PASS or FAIL, then returns structured JSON:

```json
{
  "verdict": "PASS" | "FAIL",
  "checks": [
    {"criterion": "...", "result": "PASS|FAIL", "detail": "..."}
  ],
  "critical_issues": ["..."],
  "suggestions": ["..."]
}
```

The verdict gate (Step 4) maps these to NICE/NAUGHTY: both PASS → NICE, either FAIL → NAUGHTY.

#### Reviewer A: Claude Agent (always runs)

Launch an Agent (subagent_type: `code-reviewer`, model: `opus`) with the full rubric + all files under review. The prompt must include:
- The complete rubric
- All file contents under review
- "You are an independent quality reviewer. You have NOT seen any other review. Your job is to find problems, not to approve."
- Return the structured JSON verdict above

#### Reviewer B: External Model (Claude fallback only if no external CLI installed)

First, detect which CLIs are available:
```bash
command -v codex >/dev/null 2>&1 && echo "codex" || true
command -v gemini >/dev/null 2>&1 && echo "gemini" || true
```

Build the reviewer prompt (identical rubric + instructions as Reviewer A) and write it to a unique temp file:
```bash
PROMPT_FILE=$(mktemp /tmp/santa-reviewer-b-XXXXXX.txt)
cat > "$PROMPT_FILE" << 'EOF'
... full rubric + file contents + reviewer instructions ...
EOF
```

Use the first available CLI:

**Codex CLI** (if installed)
```bash
codex exec --sandbox read-only -m gpt-5.4 -C "$(pwd)" - < "$PROMPT_FILE"
rm -f "$PROMPT_FILE"
```

**Gemini CLI** (if installed and codex is not)
```bash
gemini -p "$(cat "$PROMPT_FILE")" -m gemini-2.5-pro
rm -f "$PROMPT_FILE"
```

**Claude Agent fallback** (only if neither `codex` nor `gemini` is installed)
Launch a second Claude Agent (subagent_type: `code-reviewer`, model: `opus`). Log a warning that both reviewers share the same model family — true model diversity was not achieved but context isolation is still enforced.

In all cases, the reviewer must return the same structured JSON verdict as Reviewer A.

### Step 4: Verdict Gate

- **Both PASS** → **NICE** — proceed to Step 6 (push)
- **Either FAIL** → **NAUGHTY** — merge all critical issues from both reviewers, deduplicate, proceed to Step 5

### Step 5: Fix Cycle (NAUGHTY path)

1. Display all critical issues from both reviewers
2. Fix every flagged issue — change only what was flagged, no drive-by refactors
3. Commit all fixes in a single commit:
   ```
   fix: address santa-loop review findings (round N)
   ```
4. Re-run Step 3 with **fresh reviewers** (no memory of previous rounds)
5. Repeat until both return PASS

**Maximum 3 iterations.** If still NAUGHTY after 3 rounds, stop and present remaining issues:

```
SANTA LOOP ESCALATION (exceeded 3 iterations)

Remaining issues after 3 rounds:
- [list all unresolved critical issues from both reviewers]

Manual review required before proceeding.
```

Do NOT push.

### Step 6: Push (NICE path)

When both reviewers return PASS:

```bash
git push -u origin HEAD
```

### Step 7: Final Report

Print the output report (see Output section below).

## Output

```
SANTA VERDICT: [NICE / NAUGHTY (escalated)]

Reviewer A (Claude Opus):   [PASS/FAIL]
Reviewer B ([model used]):  [PASS/FAIL]

Agreement:
  Both flagged:      [issues caught by both]
  Reviewer A only:   [issues only A caught]
  Reviewer B only:   [issues only B caught]

Iterations: [N]/3
Result:     [PUSHED / ESCALATED TO USER]
```

## Notes

- Reviewer A (Claude Opus) always runs — guarantees at least one strong reviewer regardless of tooling.
- Model diversity is the goal for Reviewer B. GPT-5.4 or Gemini 2.5 Pro gives true independence — different training data, different biases, different blind spots. The Claude-only fallback still provides value via context isolation but loses model diversity.
- Strongest available models are used: Opus for Reviewer A, GPT-5.4 or Gemini 2.5 Pro for Reviewer B.
- External reviewers run with `--sandbox read-only` (Codex) to prevent repo mutation during review.
- Fresh reviewers each round prevents anchoring bias from prior findings.
- The rubric is the most important input. Tighten it if reviewers rubber-stamp or flag subjective style issues.
- Commits happen on NAUGHTY rounds so fixes are preserved even if the loop is interrupted.
- Push only happens after NICE — never mid-loop.
