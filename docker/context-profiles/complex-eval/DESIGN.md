# ECC Complex-Task Evaluation (complex-tasks@1)

A reproducible, public benchmark of what ECC's context scoping does for **realistic
agent work** — as opposed to the 30-task repair corpus (`ai-corpus.json`), which
measures small, single-file fixes. This document is the preregistered methodology:
it was written before the first provider call against this corpus, and it is the
reference for anyone who wants to audit or rerun the evaluation.

## Research question

Does ECC's context engineering — the full skill library, manually picked skills
(manual-lean), automatic skill matching (auto-lean), and the ECC-029 changes
themselves — change what a frontier coding agent delivers on multi-step
engineering tasks, and at what cost in tokens, time, and dollars?

## Arms

Five conditions, all launched through the same evaluator with real installs in
isolated config homes, paired per task and repeat:

| Arm | What the agent gets | What it represents |
|---|---|---|
| `full` | Branch skill library installed + ECC context block (catalog/resources) | ECC with scoping machinery present but everything loaded |
| `manual-lean` | lean profile + the maintainer-chosen canonical skill(s) injected | A user who knows exactly which ECC skill applies |
| `auto-lean` | lean profile; ECC's trigger/proposal machinery picks and injects skills | The "auto" experience: no ECC knowledge required |
| `ecc-legacy` | The full skill library **from the pinned pre-ECC-029 commit** (`legacy-source.json`, currently `e482e579` = `origin/main`), bare prompt, no context block | The typical current ECC user experience before the scoping work |
| `baseline` | No ECC install, bare prompt | The provider with no ECC at all (overhead subtraction) |

`ecc-legacy` doubles as a replication control: where its install content matches
`full`, score differences between them isolate the ECC-029 deltas (rewritten
skill descriptions, scoping layer) rather than provider noise.

## The three tasks

Chosen to be the kind of work ECC exists for — multi-step, judgment-heavy,
checkpointable — while deliberately **not** shaped around ECC's current skill
list. Queries are written as a real user would phrase them, with no ECC
vocabulary, no hints about which skill applies, and no instruction to use any
particular methodology. Each task has one clear correct outcome and a
deterministic, dependency-free grader.

1. **`webhook-relay`** (feature build). Finish an asynchronous webhook delivery
   worker: retries with exponential backoff, dead-lettering after 5 attempts,
   status reporting, under load. Graded by 9 in-process behavioral probes
   (delivery after failures, exact attempt counts, backoff timing window,
   dead-lettering, error capture, API preservation, concurrency).
   *Why it belongs here:* everyday backend feature work where test discipline
   and backend patterns genuinely change outcomes; canonical skills:
   `tdd-workflow`, `backend-patterns`.

2. **`incident-triage`** (debugging / root cause). Finance reports one-cent
   total errors since yesterday's deploy. The repo contains three changelog
   entries (two red herrings), an incident log with concrete amounts, and a
   regression: a "readability" refactor that switched integer-cent math to
   decimal-factor floats, which under-rounds exact half-cent boundaries.
   Graded by 5 boundary-value totals the float path provably gets wrong, one
   regression probe, and 2 deterministic checks on the required `INCIDENT.md`
   (names the right changelog entry, explains the rounding mechanism).
   *Why it belongs here:* evidence-driven diagnosis under uncertainty is the
   highest-leverage agent workflow; guessing is penalized because red herrings
   are plausible; canonical skill: `orch-fix-defect`.

3. **`sentinel-api`** (security review + hardening). A paste service whose
   README documents the secure contract while the code violates it five ways:
   hardcoded admin token, path traversal, reflected XSS, predictable delete
   tokens, no body-size limit. Graded by 10 exploit probes (each vulnerability
   must actually be closed) plus functional regression probes (the documented
   API must still work), including one encoded-traversal variant so partial
   fixes score partially.
   *Why it belongs here:* security review is a canonical agent task with
   objectively checkable outcomes; canonical skill: `security-review`.

### Why these tests are effective

- **Realism over benchmark gaming.** Each task is a small production-shaped
  repo with docs, tests, logs, and changelogs — the inputs a real engineer (or
  a real user of an agent harness) actually has. Nothing references ECC.
- **Correctness is decidable.** Every grader assertion is deterministic:
  behavioral probes against the agent's own running service, exact numeric
  answers on boundary cases, static source checks, exploit probes. No LLM
  judges, no rubrics, no human scoring.
- **Partial credit.** Graders emit `ECC_EVAL_SCORE {"score": 0..1}`, so "found
  4 of 5 vulnerabilities" registers as 0.9-of-task progress instead of a binary
  failure. Pass/fail (score = 1.0) is reported alongside the mean score.
- **Hard to luck into.** Red herrings (incident-triage), timing windows
  (webhook-relay), and exploit-verified fixes (sentinel-api) mean superficial
  plausible work scores low.
- **Fair across arms.** Hidden graders run only after the agent exits, from a
  read-only sandbox; the agent never sees the grader. The same grader scores
  every arm identically. Reference solutions score 1.0 and as-shipped fixtures
  score ≤ 0.3 (`verify-checks.js` proves both before any provider call).

## Measured variables

Per trial (one task × arm × repeat), from the provider's own usage events:

- **Fresh input tokens** (input + cache-creation), **cache-read tokens**,
  **output tokens** — the context-cost story.
- **Provider calls** per trial (1, or 2 when auto-lean needs a routing proposal).
- **Wall-clock time** per provider call and per trial (ms) — time to completion.
- **Score** (0..1) and **pass** (score = 1.0) from the hidden grader.
- **API-equivalent cost**, derived at analysis time at Anthropic Opus list
  prices ($15 / $1.50 / $75 per million fresh-input / cache-read / output
  tokens). This is an accounting convention for comparison, not a billing
  claim; subscription pricing differs.
- **Skill routing** (auto-lean): which skills the trigger/proposal machinery
  selected vs the maintainer-chosen canonical set, reported as the selection
  probe accuracy — the direct measure of "automatic skill matching".

Comparisons are **within-run only**: same provider, model, executable digest,
corpus digest, and source digest, paired by task and repeat. Cross-run and
cross-provider comparisons are invalid by design. This is a descriptive pilot
(3 tasks × 5 arms × 4 repeats = 60 trials): it estimates direction and
magnitude, not population statistics, and the report says so in its gate block.

## Reproducing or auditing

Everything below is committed; there are no hidden inputs.

```bash
# 1. Inspect the tasks: fixtures, queries, graders, and reference solutions.
ls docker/context-profiles/complex-eval/cases/
ls docker/context-profiles/complex-eval/reference/

# 2. Prove the graders: reference solutions must score 1.0, fixtures below 1.0.
node docker/context-profiles/complex-eval/verify-checks.js

# 3. Rebuild the corpus after any fixture edit (digest-pinned at registration).
node docker/context-profiles/complex-eval/build-corpus.js

# 4. Preregister (pins corpus, source, model, executable digests; no provider).
node docker/context-profiles/ai-eval.js --plan \
  --corpus docker/context-profiles/complex-corpus.json --repeats 4 \
  --provider claude --model <model> --executable /absolute/path/to/claude \
  > registration.json

# 5. Run (requires your own Claude subscription login or API key).
node docker/context-profiles/ai-eval.js --allow-real-provider \
  --registration registration.json \
  --corpus docker/context-profiles/complex-corpus.json \
  --provider claude --model <model> --executable /absolute/path/to/claude \
  --repeats 4 --max-calls 400 --deadline-ms 25200000 --call-timeout-ms 600000 \
  --artifact-dir /absolute/path/for/transcripts > report.json
```

The registration digest binds the exact corpus, evaluator source, model, and
executable; the run refuses to start if any of them drift, and aborts if the
tree changes mid-run. `--artifact-dir` retains per-trial session transcripts
for independent inspection (they never enter the report). The `ecc-legacy` arm
is pinned by commit in `legacy-source.json` and exported from git objects at
run time. The Codex provider is unsupported for this corpus (the legacy arm has
no Codex install path); `--provider claude` is required.

## Known limits

- Three tasks is a probe, not a census: treat intervals as descriptive.
- Tasks are Node.js/stdlib by construction (graders must be hermetic); results
  say nothing about other ecosystems directly.
- `webhook-relay` uses wall-clock backoff windows; bounds are wide (250–5000ms)
  but loaded machines could in principle flake a timing probe. The grader
  reports each probe individually so flakes are visible.
- Provider behavior varies week to week; the pinned model/executable digests
  make a rerun comparable only within the same pin.
