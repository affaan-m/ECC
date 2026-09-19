# Evaluation Criteria — Detailed Scoring Guide

This reference provides concrete scoring anchors for each axis. Use it when you're unsure whether a gap merits a 4 vs a 3, or a 2 vs a 1.

## Accuracy

| Score | Anchor | Example |
|---|---|---|
| 5 | All facts verified against tool output, docs, or authoritative sources. No errors. | Configured retry via httpx transport — confirmed in httpx docs. All method names verified with grep against codebase. |
| 4 | One minor inaccuracy that doesn't affect correctness. | Correct library, wrong default value for one parameter (claimed 0.5s, docs say 1.0s). |
| 3 | One significant factual error, or 3+ minor inaccuracies. | Used `urllib3.Retry` in an httpx codebase. Works in this one case but wrong library. |
| 2 | Multiple significant errors. Output would fail if followed. | Claimed "add this to package.json" but project uses pyproject.toml. Two other config claims also wrong. |
| 1 | Fundamentally incorrect. Output contradicts itself or known facts. | Code has syntax errors. API endpoint doesn't exist. Claims a function signature that grep disproves. |

## Completeness

| Score | Anchor | Example |
|---|---|---|
| 5 | All explicit and implicit requirements covered. Edge cases handled. Error paths addressed. | User said "add retry to all HTTP requests." GET, POST, PUT, DELETE all covered. Timeout, 429, 5xx all handled. |
| 4 | All explicit requirements covered. One implicit requirement missed. | All HTTP methods covered. Forgot to handle connection timeouts (not mentioned but expected). |
| 3 | One explicit requirement missed, or 2+ implicit gaps. | User said "add logging too." Retry logic added but no logging. |
| 2 | Multiple explicit requirements missed. Output is a partial solution. | Asked for retry + circuit breaker. Only retry implemented. |
| 1 | Misses the core request. Delivers something adjacent to what was asked. | Asked for retry logic. Wrote a health check endpoint instead. |

## Clarity

| Score | Anchor | Example |
|---|---|---|
| 5 | Perfectly structured. Jargon explained or avoided. Visual hierarchy helps scanning. No ambiguity. | README with clear sections, code blocks, and a 10-second summary at top. |
| 4 | Generally clear. One section could be better organized or one term undefined. | Good structure but `exponential backoff` used without explanation — assumes the reader knows it. |
| 3 | Understandable after re-reading. Multiple organizational issues or undefined terms. | The explanation circles the point before getting to it. Several terms used before defined. |
| 2 | Confusing in places. Reader would need to ask follow-up questions. | Code works but the PR description doesn't explain why retry was needed or what it fixes. |
| 1 | Unintelligible or contradictory. Reader cannot determine what was done or why. | Output is a wall of text with no structure. Conclusions contradict earlier statements. |

## Actionability

| Score | Anchor | Example |
|---|---|---|
| 5 | Single action required. Verification path included. No implicit steps. | "Merge this PR. Tests pass: `42 passed`. Deploy with `./deploy.sh`." |
| 4 | Single action required but verification path is implied, not explicit. | "Merge this PR." (Tests exist but weren't cited. User has to check themselves.) |
| 3 | Multiple actions required, or one action with unclear next step. | "Review and merge. Then update the config." (Which config? Where? No link or path.) |
| 2 | User must figure out how to use the output. Missing critical instructions. | Code written but no test file, no run instructions, no PR created. User has to assemble everything. |
| 1 | Output cannot be acted on without significant rework or clarification. | "Here's a design idea." (No code, no file, no PR. User has to start from scratch.) |

## Conciseness

| Score | Anchor | Example |
|---|---|---|
| 5 | Every sentence earns its place. No redundancy. Information density is high. | 30 lines that say what 60 lines would. No repeated points. No filler. |
| 4 | Minor redundancy. One paragraph could be tightened. | Good overall but repeats the motivation in both the PR description and code comments. |
| 3 | Noticeable redundancy. 20%+ of content could be removed without loss. | Explains the same concept three times (in summary, body, and conclusion). Verbose examples. |
| 2 | Significantly bloated. 40%+ of content is filler or repetition. | 200 lines for a task that needed 60. Restates the user's question. Includes irrelevant background. |
| 1 | Noise-to-signal ratio is inverted. More filler than substance. | 500-line response to a 2-line question. Most of it is boilerplate, repetition, or irrelevant context. |

## Edge Cases

### When the user gave unclear instructions

If the user's request was ambiguous, do NOT penalize completeness for not reading minds. Instead, note in the evaluation: "User's request was ambiguous about [scope]. I chose interpretation [chosen interpretation]. If they meant [alternative interpretation], this score would drop to [score]."

### When the task is inherently simple

A 3-line bug fix can legitimately score 5/5/5/5/5. The rubric scales with complexity — a simple task done perfectly IS a 5.0. Don't invent gaps to justify lower scores.

### When you caught your own error mid-task

If you made an error, caught it, and fixed it before delivering — that's a 5 on Accuracy for the final output. The evaluation is about what the user received, not your internal process. Note the self-correction as evidence of thoroughness, not as a penalty.

### When the tool output contradicts your claim

If you claimed "tests pass" but the terminal output shows a failure — that's an automatic Accuracy ≤ 2. Tool output is ground truth. Claims without verification are the most common source of low accuracy scores.
