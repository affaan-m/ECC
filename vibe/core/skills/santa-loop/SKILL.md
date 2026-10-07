---
name: santa-loop
description: Adversarial dual-review convergence loop — two independent model reviewers must both approve before code ships. Use for the CLI-driven version of this loop; wraps the santa-method skill.
user-invocable: true
metadata:
  origin: ECC
  source: commands/santa-loop.md
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

Determine the scope from `(the text typed after the skill name)` or fall back to uncommitted changes:

```bash
git diff --name-only HEAD
```

Read all changed files to build the full review context. If `(the text typed after the skill name)` specifies a path, file, or description, use that as the scope instead.

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

#### Reviewer B: External Model (Claude fallback if no external reviewer is ready)

Antigravity is optional and requires the external `ccg-workflow` runtime; it is not included in the base ECC install. An existing installation must provide both an executable `~/.claude/bin/codeagent-wrapper` and a readable regular reviewer role file at `~/.claude/.ccg/prompts/antigravity/reviewer.md`. Otherwise, retain the Claude fallback. Use the wrapper's maintained model-selection contract; do not add an Antigravity model pin.

Run detection, prompt creation, and the selected external review together in this single Bash subshell. Replace the prompt placeholder with the same rubric, file contents, and review-only instructions given to Reviewer A. The order remains Codex, Gemini, Antigravity, then Claude. The Claude fallback creates no prompt file.

```bash
(
  set -e
  set -o pipefail

  REVIEWER_WRAPPER="$HOME/.claude/bin/codeagent-wrapper"
  REVIEWER_ROLE="$HOME/.claude/.ccg/prompts/antigravity/reviewer.md"
  if command -v codex >/dev/null 2>&1; then
    REVIEWER_BACKEND=codex
  elif command -v gemini >/dev/null 2>&1; then
    REVIEWER_BACKEND=gemini
  elif [ -x "$REVIEWER_WRAPPER" ] && [ -f "$REVIEWER_ROLE" ] && [ -r "$REVIEWER_ROLE" ]; then
    REVIEWER_BACKEND=antigravity
  else
    printf '%s\n' 'CLAUDE_FALLBACK'
    exit 0
  fi

  cleanup_reviewer_prompt() {
    reviewer_status=$?
    trap - EXIT
    if ! rm -f -- "$PROMPT_FILE"; then
      printf '%s\n' 'Could not remove reviewer prompt; remove the private temp file before continuing.' >&2
      if [ "$reviewer_status" -eq 0 ]; then reviewer_status=1; fi
    fi
    exit "$reviewer_status"
  }

  umask 077
  PROMPT_FILE=$(mktemp "${TMPDIR:-/tmp}/santa-reviewer-b.XXXXXX")
  trap cleanup_reviewer_prompt EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  cat > "$PROMPT_FILE" << 'EOF'
... full rubric + file contents + reviewer instructions ...
EOF

  case "$REVIEWER_BACKEND" in
    codex)
      codex exec --sandbox read-only -m gpt-5.4 -C "$(pwd)" - < "$PROMPT_FILE"
      ;;
    gemini)
      REVIEWER_PROMPT=$(cat "$PROMPT_FILE")
      gemini -p "$REVIEWER_PROMPT" -m gemini-2.5-pro
      ;;
    antigravity)
      {
        printf 'ROLE_FILE: %s\n' "$REVIEWER_ROLE"
        cat "$PROMPT_FILE"
      } | "$REVIEWER_WRAPPER" --backend antigravity - "$PWD"
      ;;
  esac
)
```

The subshell removes its prompt on success, backend or prompt-write failure, and handled HUP/INT/TERM signals, preserving the original failure status. A cleanup-only failure also returns nonzero. Forced termination such as SIGKILL cannot run cleanup; inspect private temp files after an interrupted process. A failed external invocation is not an approval and must not silently become a fallback or proceed to the verdict gate.

**Claude Agent fallback:** If the subshell prints `CLAUDE_FALLBACK`, launch a second Claude Agent (subagent_type: `code-reviewer`, model: `opus`) with the rubric and file contents directly. The marker is a dispatch instruction, not a review verdict. Log that both reviewers share the same model family; keep their contexts separate.

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
- Model diversity is the goal for Reviewer B. Record the actual model/provider reported by the selected backend; the Antigravity wrapper name alone does not establish a different model family. The Claude-only fallback provides context isolation but loses model diversity.
- Use each backend's maintained model-selection contract. Do not pin a transient Antigravity model ID in this workflow.
- Request review-only output from every reviewer. Codex uses `--sandbox read-only`; Gemini and Antigravity permissions depend on their installed runtime configuration. The CCG wrapper invocation alone does not guarantee a read-only sandbox.
- Fresh reviewers each round prevents anchoring bias from prior findings.
- The rubric is the most important input. Tighten it if reviewers rubber-stamp or flag subjective style issues.
- Commits happen on NAUGHTY rounds so fixes are preserved even if the loop is interrupted.
- Push only happens after NICE — never mid-loop.
