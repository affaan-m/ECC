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
   and backend patterns genuinely change outcomes; canonical skill:
   `tdd-workflow` (a second skill would exceed the 32 KB selection budget —
   itself a measured constraint of the scoping layer).

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
- Fixture wart observed in the 2026-09-25 run: on Node 24, `node --test test/`
  no longer scans the directory the way Node 22 did, so `npm test` fails as
  shipped. This is identical for every arm (the task says to make `npm test`
  pass, and agents fix the script), so fairness holds, but it adds unplanned
  work per trial. A future corpus revision should ship a portable test script.

## complex-tasks@2 (discriminative revision)

The @1 run saturated: every arm scored 1.000 on every task, so only economics
and routing differed. @2 (`cases2/`, built to `complex-corpus-v2.json`) is
designed to discriminate on the axes users actually pay for — correctness on
traps, solution efficiency, spec thoroughness — with wide partial-credit
spreads. The @1 corpus and its report stay untouched for comparability.

1. **`keccak-selector`** (domain-knowledge trap). Implement Ethereum function
   selectors from scratch, stdlib only. The trap: Node's crypto offers
   SHA3-256, which shares the Keccak-f[1600] permutation but differs in
   padding — the naive one-liner is wrong for every vector (verified: the
   naive control scores 0.25, format checks only). Graded by 9 selector
   vectors including a padding edge case, all cross-validated against Node's
   SHA3-256 on shared-permutation inputs. Canonical skill: `nodejs-keccak256`.
   *Hypothesis:* the skill body carries exactly this knowledge; bare agents
   must rediscover it.

2. **`event-stats-api`** (correctness edges + measured efficiency). A shipped
   implementation that is both wrong on the documented edge semantics
   (interpolated instead of nearest-rank percentiles, zeros instead of nulls,
   unrounded averages, missing 400s) and algorithmically naive (full-log scan
   + sort per query). Graded by 10 independently computed correctness probes
   plus a measured 2,000-query performance budget (threshold 6s; shipped naive
   ~7.7s, reference ~1.5s — calibrated on the grading machine in
   `calibrate-stats.js`). Canonical skill: `backend-patterns`. *Hypothesis:*
   solution *efficiency* separates arms even when correctness doesn't.

3. **`forge-cli`** (spec thoroughness + robustness). Twelve contractual
   behaviors with exact messages, exit codes, sorting, and a never-throw
   guarantee, graded by 26 checks including junk-input fuzzing and static
   hygiene (no leftover TODO/FIXME, no new dependencies). Canonical skill:
   `tdd-workflow`. *Hypothesis:* checklist discipline shows up as breadth of
   completion, and partial credit spreads the distribution.

First @2 run uses `claude-opus-4-8` (cost discipline); the corpus is
provider- and model-pinned per run, so a later Opus 5.5 rerun on the same
digest measures the model difference directly. repeats=2 (30 trials): simple
experimentation, expand later.

## complex-tasks@3 (vagueness and horizon; arms: auto-lean vs baseline)

@2 still saturated on outcomes (30/30) — enumerated specs are within the
model's cold competence. @3 (`cases3/`, built to `complex-corpus-v3.json`)
moves grading to what users actually complain about (see the complaint
taxonomy in this file's discussion: happy-path-only work, unverified
completion, skipped implied work, convention drift, concurrency blindness).
Everything graded is discoverable from repo docs visible to every arm — the
question is whether agents reliably *do* all of it under vague instruction.

1. **`chained-tickets`** (long horizon). Four sequential tickets in one
   accumulating workspace — build a link shortener core, then vague tickets:
   "links need to survive a restart", "we're seeing abuse, deal with it",
   "track redirect hits, consistent with the existing API". 33 hidden probes
   across the four steps grade function, convention compliance (error
   envelope, layering — pinned in a visible CONTRIBUTING.md), and implied
   work (changelog entries, growing tests, accurate README). Stepped trials
   grade each ticket after its call; a failed ticket ends the chain.
2. **`production-ready`** (vague prompt, heavy implication). "This goes to
   production Monday — get it ready." A documented production bar
   (validation envelopes, body limits, /health, structured request logs, env
   config, graceful SIGTERM, nosniff, error-path tests, changelog) graded by
   16 probes against a naive prototype. Fixture scores 0.063.
3. **`idempotent-webhooks`** (the "almost right" trap). A payment receiver
   whose shipped code has a textbook check-then-act race (INC-104). Hidden
   grader fires 50 concurrent identical deliveries plus replay, already-paid,
   mixed-storm, and contract probes. The naive fixture double-applies and
   crashes on unknown orders (0.25). Exactly-once requires claiming events
   synchronously — the discipline skills like `error-handling` encode.

Grader robustness (hard-won, now fixed and unit-tested): a graded server runs
in-process, so a crashing server kills the grader. Graders install
uncaughtException/unhandledRejection handlers, emit their score line via
`process.stdout.write` (immune to the log-capture patching used in probes),
pre-declare their check totals (unreached checks score zero), and the
evaluator itself treats a score-advertising grader that printed nothing as a
zero (`graderDied` guard in `runScoredCheck`). Stepped graders may write to
the workspace (persistence probes); single-step graders stay read-only.

First @3 run: arms `auto-lean` and `baseline` only, repeats=1,
`claude-opus-4-8` — the direct test of "ECC auto-routing vs no harness" on
quality, time, and tokens. Full-arm and Opus 5.5 replications follow if the
spread shows up.
