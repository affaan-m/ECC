# GateGuard question effectiveness

The scenario gate in [evaluation.md](evaluation.md) checks that GateGuard asks
the right questions. This evaluation checks whether asking them changes the
outcome: real Claude sessions do small coding tasks that each hide one trap,
with and without the gate, and a hidden grader scores the result.

The harness is development-only and lives in `docker/gateguard-effectiveness/`,
which the npm package does not ship.

## Hypotheses

Written before the pilot ran:

1. The gate (`gate`) passes more trapped tasks than no gate (`off`).
2. The gate passes more trapped tasks than a placebo gate that denies the same
   calls with generic questions (`placebo`); otherwise the gain comes from
   stopping the agent, not from what it is asked.
3. Removing the question meant to catch a trap (`minus-target`) lowers the pass
   rate on that trap.
4. The gate's cost (turns, tokens, wall time) is reported next to its effect.

The pilot (6 scenarios, 4 arms, 3 repetitions: 72 sessions) is sized to
estimate effects and variance, not to establish significance. A full run is
worth its cost when the pilot's `gate` minus `off` pass-rate difference is at
least 15 points or a `minus-target` difference is visible on its own trap.
Results are reported whichever way they come out.

## Scenarios

Each scenario is a small repository in `scenarios/<id>/workspace`, a prompt a
user could send, the trap, the question meant to catch it (`targetQuestions`),
a hidden `grader.cjs`, and two overlays used only by the tests: `reference`
(a correct solution, which must score 1) and `naive` (the trap taken, which must
not). The start workspace must not pass either.

| Scenario | Trap | Target question |
| --- | --- | --- |
| `importers-date-shape` | `parseDate` changes return type; three modules in two folders read its old fields | `importers`, `local-callers` |
| `local-callers-normalize` | A private helper changes shape; three functions in the same file rely on it | `local-callers` |
| `data-schema-orders` | A CSV with `;` separators, day-first dates and decimal commas; the first 30 rows also parse month-first | `data-schema` |
| `no-duplicate-slug` | A new slug helper is requested; an existing `slugify` folds accents, spells out `&` and caps length | `no-duplicate` |
| `existing-tests-discount` | A rate changes and a test is requested; an existing test pins the old rate | `existing-tests` |
| `secrets-config-key` | A key is to be added to committed config that references secrets as `${NAME}` from a gitignored `.env` | `no-plaintext-secrets` |

The tests check, for every scenario, that the candidate gate asks a target
question for the edits the reference solution makes. The importers trap lists
`local-callers` too: the gate routes a change inside an exported function's
body to `local-callers`, not `importers` (see [Findings](#findings)).

Dotfiles are stored as `dot-<name>` so the repository's own ignore rules do not
apply to them; the harness restores the leading dot.

## Arms

| Arm | Gate |
| --- | --- |
| `off` | none |
| `gate` | the candidate commit's gate, unmodified |
| `minus-target` | the candidate gate without the scenario's target questions |
| `placebo` | the candidate gate with every question but the verbatim-instruction one replaced by a generic one, keeping the count |
| `main` (optional) | the gate at `--main-ref` |

Each gate arm runs `scripts/` extracted from its commit with `git archive`,
through `run-with-flags.js` as installed hooks do, registered for
`Edit|Write|MultiEdit|NotebookEdit` and `Bash|PowerShell`. A small wrapper
(`scripts/hooks/gateguard-arm.js` in the extracted tree) reads
`hook-run.json` from the trial folder, sets the trial's state directory and
applies `arm-patch.js` to the question tables before the hook loads. The
shipped hook is not changed. Condensed hints follow the patched questions; a
class whose questions an arm leaves alone keeps its original hint.

## Running a trial

Each trial gets a fresh copy of the workspace committed to a new git
repository, a fresh GateGuard state directory and one headless session:

```text
claude --print --output-format stream-json --verbose --no-session-persistence
  --permission-mode bypassPermissions --setting-sources project --strict-mcp-config
  --settings <trial settings> --max-turns <n> --model <model>
```

`--setting-sources project` and `--strict-mcp-config` keep the user's own
settings, plugins and MCP servers out of every arm; the trial settings carry
only the arm's hooks. The session uses the existing Claude login or
`ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN`; the harness never reads
credential files. The prompt is the scenario prompt plus one line asking the
agent to work without clarifying questions.

After the session exits, the grader is copied in and run with Node's
permission model (read-only on the workspace where Node supports it). Graders
print a score from 0 to 1; only a full score passes, and a grader that crashes
scores 0.

A gate arm whose agent edited files without any sign of the gate (no metrics
line and no denial in the transcript) stops the run, so a broken hook setup
does not spend the remaining sessions.

## Measures

Per trial (`results.jsonl`): pass and score; gate denials seen in the
transcript and decision metrics from the hook; the questions asked; how many of
the scenario's `evidence` patterns the agent stated in its own text (for
example the three importers); turns, tokens, cost and wall time as reported by
Claude; and provider errors or timeouts. The full transcript of each trial is
kept in `transcripts/`.

## Analysis

Arms run in a seeded shuffled order inside each scenario and repetition, so
drift over the run affects them alike. `summary.md` reports per arm the pass
rate with a Wilson 95% interval, mean score, evidence stated, median denials,
turns, tokens and cost; per scenario the passes in each arm; and for each arm
against `gate`, paired by scenario and repetition, the pass-rate difference
with a 95% bootstrap interval and an exact McNemar test on the discordant
pairs. Provider errors and timeouts are counted but left out of comparisons.

## Reproduce

```bash
node docker/gateguard-effectiveness/run.js --out gg-eff --dry-run
node docker/gateguard-effectiveness/run.js --out gg-eff --model <model> --allow-real-provider
node docker/gateguard-effectiveness/run.js --out gg-eff --summarize
node tests/docker/gateguard-effectiveness.test.js
```

A rerun with the same `--out` resumes; changing the model or commit needs a new
folder. `--arms off,gate,main` compares the routing of two commits.

## Limits

- The traps and graders were written by the author of the questions they
  test. Scenarios written by someone else, before seeing results, are the
  stronger check.
- Agents run with `bypassPermissions` in a temporary folder. Claude Code has
  no write sandbox for that folder, so run the harness on a machine where a
  stray command is acceptable.
- The user's own memory file (`CLAUDE.md` in the Claude config folder) is not
  a setting source and still loads; it is the same in every arm.
- Six scenarios and three repetitions detect only large effects. Each
  scenario tests one question; questions without a scenario are not measured.

## Findings

- A change inside an exported function's body that alters its contract (here
  `parseDate`'s return type) is routed to `local-callers` ("call sites in this
  file or its module") rather than `importers`, because the change profile
  sees no public-surface line in the edit. `main` asks `importers` for every
  code edit. The `main` arm measures whether this costs outcomes.
- The `parseDate` edit is also asked `data-schema`, because `Date` counts as a
  data word.

## Pilot results

The pilot ran: 6 scenarios, 4 arms, 3 repetitions, 72 sessions, sonnet, hook
commit `bdf2dca6`. It returned no information at all.

| Arm | Passed | Mean score | Median denials | Median turns |
| --- | ---: | ---: | ---: | ---: |
| `off` | 18/18 | 1.000 | 0 | 4.5 |
| `gate` | 18/18 | 1.000 | 1 | 6 |
| `minus-target` | 18/18 | 1.000 | 1 | 5 |
| `placebo` | 18/18 | 1.000 | 1 | 6 |

Every arm passed every trial on every scenario. Each arm-against-`gate`
difference is 0% with a 95% interval of 0% to 0% and McNemar p = 1. The
pre-registered rule asked for a `gate` minus `off` difference of at least 15
points before funding a full run; the difference is 0, so the full run is not
worth its cost and the hypotheses are untested rather than refuted.

With the outcome fixed at 1 for every trial there is no variance for any arm to
explain, so this is not weak evidence that the gate does nothing — it is the
absence of a measurement. What the run does establish is the gate's cost in
this regime: `gate` spends about 45% more turns and 28% more tokens than `off`
and changes no outcome.

### Why it measured nothing

1. **Every trap hid its deciding fact in the repository.** `no-duplicate-slug`
   is the clearest: the grader passes only when `tagFor` agrees with the
   existing `src/util/text.js`, so an agent asked for a URL-safe slug greps,
   finds `slugify` and reuses it. The existing test, the CSV's later rows and
   the `.env` convention are the same shape. Agents are reliably good at
   discovering repository facts, so the gate was measured where it cannot help.
2. **The asking channel was switched off.** Trials ran one-shot with "Work
   autonomously in this repository and do not ask clarifying questions". A
   fact-forcing gate was evaluated with no user to answer it, so the only
   mechanism left was the agent restating facts to itself.
3. **The checks could not fail.** Each scenario declared `targetQuestions`, and
   the suite asserted the gate asks one of them for the reference edits. Those
   targets were chosen by reading the gate's own question taxonomy, so the
   assertion held by construction. The scenario set was likewise built around
   the six questions the gate already had, so the design could only confirm
   existing coverage and never discover a missing question.

The first `Limits` bullet anticipated (1) and (3) in part. It understated them:
the problem is not only that the author wrote both sides, but that the pass
criterion referred to the gate's own vocabulary.

## Hidden-intent evaluation

`docker/gateguard-effectiveness/scenarios-intent/` and `run-intent.js` answer a
different question, and are built so that a null result cannot be manufactured
by construction.

**The deciding fact is only in the user's head.** Each scenario carries an
`intent.json` holding an ambiguity the repository cannot settle and the facts
that resolve it, each marked `decisive` or not. `audit-retention-purge` asks for
"our audit retention policy" to be applied; the workspace offers
`config/retention.json` with `sessionDays: 30` and no audit key, while the real
policy is 400 days and a soft mark. Nothing in the tree says so, so an agent
that does not ask can only guess, and the ungated arm cannot sit at the ceiling.

**A simulated user answers only what is actually asked.** `user-sim.js` runs a
separate cheap model holding the facts, under instructions to answer the
question in front of it, never volunteer, and otherwise repeat a stonewall line.
It reports which fact ids it disclosed, so "asked something" and "asked the
deciding thing" are distinguishable. A judge whose reply cannot be parsed is
recorded as a judge failure rather than silently read as a stonewall.

**Sessions are multi-turn and symmetric.** `session.js` joins turns with
`--session-id` and `--resume`. Every arm, gated or not, is told the user is
reachable, so the gate's contribution is whether it makes the agent ask the
deciding question — not whether asking was permitted.

**Scenario files do not encode gate targets.** `task.json` must not declare
`targetQuestions`; the loader rejects it, and questions a scenario provokes are
observed from the run. This is a file-format guard, not evidence of blind or
independent authorship: the authors knew the taxonomy, and the later
`external-contract` question was added after inspecting this corpus. Results
for that question are exploratory. A confirmatory corpus needs independent
authors who have not seen the taxonomy or interim results, with scenarios frozen
before evaluation.

### Hole classes

Each trial is classified from behaviour alone — whether the gate fired, whether
the agent asked, whether the deciding facts came out, and whether the outcome
was right. Nothing in the classification reads the taxonomy.

| Class | Meaning |
| --- | --- |
| `working` | the deciding fact was obtained and the outcome is right |
| `lucky` | right outcome without asking: the scenario does not force the question |
| `follow-through-hole` | the fact was obtained and the outcome is still wrong |
| `targeting-hole` | the agent asked, but not for the deciding fact |
| `silence-hole` | the gate fired and the agent still did not ask |
| `coverage-hole` | a deciding ambiguity the gate never engaged, and the outcome is wrong |

A scenario is reported as carrying no information when nothing varies across
arms — every trial passing or every trial failing. Trap strength (how often the
ungated arm passes) is reported separately and does not decide usability, since
the ungated arm failing is what a working trap looks like.

Graders are checked before any session is billed: the start workspace and the
`naive` overlay must both score below 1 and `reference` must score 1, or the run
stops.

### Hidden-intent results

Six scenarios authored by someone familiar with the taxonomy, `off` and `gate`, four repetitions, 48 trials,
sonnet under test and haiku as the user. No provider errors, timeouts or judge
failures, and the hook was observed in every gated trial. $7.14.

The numeric runs in this section are historical aggregates: their row-level
results and transcripts are not in this repository, so they cannot be
independently recomputed here. Some were originally summarized after excluding
floor/ceiling scenarios. The current runner instead includes every valid
predeclared scenario/repetition pair in the primary comparison; do not treat
these old aggregate tables as output from the current analysis protocol.

**Disclosure was associated with passing in this corpus.** In this initial run,
28/28 trials that disclosed the deciding facts passed, while 3/20 that did not
disclose them also passed:

| Arm | got the fact, passed | did not, passed |
| --- | ---: | ---: |
| `gate` | 14/14 | 1/10 |
| `off` | 14/14 | 2/10 |

This small observational comparison is consistent with the intended mechanism;
it does not establish that disclosure is necessary, sufficient, or causal.

**The gate does not change whether the agent asks.** Paired by scenario and
repetition, exact McNemar:

| Measure | `gate` | `off` | Discordant | p |
| --- | ---: | ---: | --- | ---: |
| Asked the user | 14/24 (39-76%) | 15/24 (43-79%) | 4 vs 5 | 1.000 |
| Obtained the deciding fact | 14/24 (39-76%) | 14/24 (39-76%) | 5 vs 5 | 1.000 |
| Passed | 15/24 (43-79%) | 16/24 (47-82%) | 4 vs 5 | 1.000 |

On the five scenarios that separate any arm, the paired pass-rate difference is
5 points in `off`'s favour with a 95% interval of -25% to +35%. This interval
does not exclude a large benefit. Under the stated assumptions, 20 pairs has
about 80% power to detect a 40-point difference; it does not imply that a
non-significant result rules out that effect.

**The cost is consistent.** `gate` spends 8.3 turns and $0.176 per trial against
5.9 and $0.121, about 41% more turns and 45% more cost, with mean score slightly
lower (0.639 against 0.681).

**The gate fires, and firing does not convert into asking.** Denials were
recorded in 22 of 24 gated trials, so the hook is engaging.
`timezone-daily-rollup` is the clearest case: the gate fired in all four trials
and the agent asked the user in none of them. Across the corpus that is seven
`silence-hole` trials. The questions actually raised were `callers`,
`config-effect`, `config-reader`, `data-schema`, `importers`, `no-duplicate`,
`public-api`, `quote-instruction`, `existing-tests` and `under-test` - all about
code structure, while every deciding fact in this corpus is an external
contract: a CSV dialect, a reporting timezone, retry safety against a
non-idempotent endpoint, collation rules, a quota policy. That mismatch is the
improvable gap, and it was not expressible in the declared-target design.

### What the earlier runs cost to learn

The first six scenarios each declared several decisive facts. Because the
simulated user answers only what it is asked and never volunteers, and
`disclosedDecisive` requires every decisive fact, those scenarios could not be
won: `csv-export-delimiter` was asked about in five of eight trials and the
deciding set never completed, with `quoting` never disclosed.
`soft-limit-overage` failed differently, scoring zero in all eight trials even
when the facts arrived, because its grader demanded an `{ allowed, overage }`
shape nothing disclosed - it was scoring whether the agent guessed field names.

Hence two rules the scenarios now follow: **one decisive fact per scenario**, so
a single well-aimed question can obtain it, and **anything a grader checks about
shape is stated in the prompt**. Three of six scenarios sat at floor before that
change and none does after it.

The correction has a cost of its own, and it bounded that result. Moving shape
and constraints into the prompt also signposted the ambiguity: the prompts said
"the dialect our consumer expects" and "the calendar our reports are read
against", which invites a question in every arm. Ungated pass rates rose
accordingly - `retry-idempotency` reached 4/4 and was excluded as a ceiling,
with `csv-export-delimiter` and `soft-limit-overage` at 3/4. So that run
established only this: **where the ambiguity is already signposted, the agent
asks about half the time whatever the gate does.**

### The unflagged regime

The prompts were then rewritten to read as ordinary tickets, with every phrase
hinting at an unseen convention removed. Shape a grader checks stayed, stated
mechanically: `checkQuota` still documents `{ allowed, overage }` and defines
`overage` as how far usage exceeds the limit, which says nothing about whether
exceeding it is allowed. Graders, workspaces and intents were untouched, so one
variable moved. Predicted before the run: this is where the gate should look
best if it works at all, because the interruption is then the only thing in the
loop that could surface an unknown.

48 trials, no provider errors, timeouts or judge failures, $6.46. Every scenario
became informative, with ungated pass rates between 25% and 50%.

| Measure | `gate` | `off` | Discordant | Exact p |
| --- | ---: | ---: | --- | ---: |
| Asked the user | 16/24 (47-82%) | 10/24 (24-61%) | 7 vs 1 | 0.070 |
| Obtained the deciding fact | 16/24 (47-82%) | 10/24 (24-61%) | 7 vs 1 | 0.070 |
| Passed | 15/24 (43-79%) | 8/24 (18-53%) | 9 vs 2 | 0.065 |

The paired pass-rate difference is 29 points in `gate`'s favour, bootstrap 95%
interval -54% to -4%. That interval excludes zero while the exact McNemar test
does not reject at the 5% level; on eleven discordant pairs the percentile
interval is the less conservative of the two, and the exact test is the one to
read.

In this run, no trial passed without the deciding fact (0 of 8 for `gate`, 0 of
14 for `off`). With the fact, `gate` passed 15 of 16 and `off` 8 of 10. This
observed association is not proof that asking is necessary or sufficient.

The contrast between regimes is the clearest part, because the gated arm barely
moved while the ungated arm halved:

| Arm | Passed, signposted | Passed, unflagged |
| --- | ---: | ---: |
| `gate` | 15/24 | 15/24 |
| `off` | 16/24 | 8/24 |

Cost rose with it: `gate` spent 8.7 turns and $0.166 against 5.8 and $0.103,
about 50% more turns and 61% more cost, and this time mean score favoured the
gate too, 0.681 against 0.458.

**This is suggestive and not established.** Three measures land at p = 0.065 to
0.070, consistent with each other and with the mechanism, and the direction was
predicted in advance. But all three sit just above the conventional threshold,
and a single further gate-favouring discordant pair would cross it, so extending
this run is exactly the optional stopping that would make the p-value
meaningless. Settling it needs a fresh confirmatory run at a sample fixed in
advance: from the observed discordant rate of 11 in 24 and an 0.82 split, 80%
power at the 5% level needs about 43 pairs, which is 8 repetitions over these
six scenarios, 86 trials and roughly $12.

What this does establish is that the earlier null was regime-bound. The gate's
value, if it has one, is in surfacing an ambiguity nobody has flagged - which is
the case the first evaluation could not construct, because its traps hid their
deciding facts in the repository and its prompts forbade asking.

One scenario was reworked before the confirmatory run rather than carried into
it with a known leak. `soft-limit-overage` had asked for `{ allowed, overage }`,
and naming an overage figure hints that passing a limit is permitted, which is
the hidden policy. Its grader now inspects only `allowed`, so the prompt asks
for `{ allowed }` and says nothing about overage, billing or soft limits. A hard
limit refuses the first two cases, allowing everything fails the third, and only
the real policy answers all three.

### Confirmatory run, pre-registered

Written before the run, and not revised after it. The unflagged result above is
the exploratory finding this is meant to confirm or fail to confirm.

- **Hypothesis.** On unflagged prompts, `gate` passes more trapped tasks than
  `off`.
- **Primary outcome.** `passed`, paired by scenario and repetition, two-sided
  exact McNemar, alpha 0.05. Nothing else decides the claim.
- **Sample, fixed now.** Six scenarios, `off` and `gate`, eight repetitions: 48
  pairs and 96 trials. 43 pairs is the 80%-power requirement for the effect the
  exploratory run suggested, and eight repetitions is the smallest whole number
  over six scenarios that clears it.
- **No extension.** The run is not lengthened, shortened or repeated on the
  strength of its own result. A near-miss stays a near-miss.
- **Frozen inputs.** Scenarios, graders, intents, prompts, arms, model and judge
  are those of the commit this run pins. No scenario is added, removed or edited
  once it starts.
- **Secondary, reported but not claim-bearing.** `asked`, `disclosedDecisive`,
  turns and cost, each with the same paired test. These describe the mechanism;
  they do not establish it.
- **Validity rule.** Trials with a provider error or timeout are excluded and
  counted. If more than 10% of trials are invalid, the run is reported as
  inconclusive rather than analysed.
- **Reporting rule.** The result is reported whichever way it comes out,
  including a null, and the exact test is read in preference to the bootstrap
  interval when the two disagree.

### Confirmatory result: not confirmed

96 trials as planned, none invalid - no provider error, timeout or judge
failure, and the hook observed in every gated trial. $12.42. All six scenarios
informative, with ungated pass rates from 13% to 75%.

**Primary outcome.** `passed`: `gate` 25 of 48 (52%), `off` 18 of 48 (38%). On
48 pairs the discordant split is 15 in `gate`'s favour against 8, and the exact
two-sided McNemar p is **0.210**. At the pre-registered alpha of 0.05 the
hypothesis is **not confirmed**. The bootstrap interval agrees this time, -15%
with a 95% range of -33% to +4%, which includes zero, so there is no tension
between the two tests to adjudicate.

**Secondary measures,** reported and not claim-bearing: asked the user 29/48
against 22/48 (p = 0.230), obtained the deciding fact 27/48 against 21/48
(p = 0.327). Both point the same way as the primary and neither reaches
significance.

**Observed disclosure remained strongly associated with passing.** No trial in
either arm passed without the deciding fact - 0 of 21 for `gate`, 0 of 27 for
`off` - and with the fact, `gate` passed 25 of 27 and `off` 18 of 21. This is
consistent with the proposed mechanism, but scenario-level observational data
do not establish necessity, sufficiency, or causal mediation. The gate did not
reliably cause disclosure in this run.

**The cost is the most reliable number in the evaluation.** `gate` spent 8.2
turns and $0.151 per trial against 6.0 and $0.108, about 37% more turns and 40%
more cost. That has held within a few points across every run, flagged and
unflagged, null and suggestive.

The point estimate was smaller in the later run; these runs are not pooled, and
this difference alone does not establish a trend:

| Run | `gate` | `off` | Difference | Discordant | Exact p |
| --- | ---: | ---: | ---: | --- | ---: |
| Exploratory, unflagged | 15/24 (63%) | 8/24 (33%) | +29 pts | 9 vs 2 | 0.065 |
| Confirmatory, unflagged | 25/48 (52%) | 18/48 (38%) | +15 pts | 15 vs 8 | 0.210 |

The two runs are not pooled. The protocol differs - the quota scenario's leak
was closed between them - and combining them after seeing both results would be
the same post-hoc choice the pre-registration exists to prevent.

**What would settle it.** The confirmatory point estimate of 15 points, with its
observed discordant rate, needs about **177 pairs** for 80% power: 354 trials
and roughly $48. The design was powered for the exploratory estimate of 29
points, so if 15 is nearer the truth this run was underpowered for it by a
factor of nearly four.

### Adding an external-contract question did not help

Every question the gate raised across the corpus was about code structure, while
every deciding fact was an external contract, so an `external-contract` question
was added for code changes whose profile touches data and the 48-pair design was
rerun. 96 trials, none invalid, $11.25. This run is exploratory, not
confirmatory: the question was designed after seeing which questions these
scenarios needed, so this corpus is not independent of that design choice.

The headline looks like a win and is not one. `gate` 23 of 48 against `off` 13
of 48, paired difference 21 points, exact McNemar p = 0.021. But the comparison
moved because the baseline fell, not because the gate rose:

| Arm | Before the question | After |
| --- | ---: | ---: |
| `gate` | 25/48 | 23/48 |
| `off` | 18/48 | 13/48 |

The scenarios, prompts, graders and model alias were identical across the two
runs, and `off` has no gate, so nothing in the change could touch it. `gate`
went **down**, from 25 to 23. An intervention meant to raise the gated arm did
not raise it, and reporting p = 0.021 as evidence for it would be wrong.

The two scenarios where the question cannot fire make a natural control, because
they have no data for the profile to detect:

| Scenario | New question fired | `gate` before -> after |
| --- | ---: | ---: |
| audit-retention-purge | 3/8 | 3/8 -> 2/8 |
| csv-export-delimiter | 6/8 | 4/8 -> 3/8 |
| soft-limit-overage | 6/8 | 2/8 -> 3/8 |
| timezone-daily-rollup | 3/8 | 4/8 -> 3/8 |
| retry-idempotency | **0/8** | 8/8 -> 5/8 |
| username-collation | **0/8** | 4/8 -> 7/8 |

The two controls moved by -3 and +3, which is larger than any movement among the
four the question did reach (-1, -1, +1, -1). Run-to-run noise on eight trials
is about plus or minus three, and every effect the intervention could have had
is smaller than that.

Within the run, gated trials where the question fired passed 11 of 18 against 12
of 30 where it did not, but that contrast is between different scenarios of
different difficulty, and whether the question fires depends on what the agent
did, so it is a selection effect rather than a measurement.

The question is kept, because it asks something the gate genuinely never asked
and the corpus suggests that kind of answer matters. What is not claimed is
that adding it improved anything measurable here. A fair test needs scenarios
written by independent authors who have not seen that question or these results.

**Standing conclusion.** Across 336 billed trials the gate's benefit is not
established, its direction has been positive in the unflagged runs, and its cost
is a consistent 35 to 45% in turns and spend. "Not confirmed" is not "no
effect", and a 15-point improvement would be worth having; but it has not been
demonstrated, and nothing here licenses claiming it has. The evidence that does
hold is narrower than a verdict on the gate: disclosure of the deciding fact
was strongly associated with passing, and the gate's questions were aimed at
code structure while the deciding facts in this corpus were external contracts.

### Reproduce

```bash
node docker/gateguard-effectiveness/run-intent.js --check-graders
node docker/gateguard-effectiveness/run-intent.js --out gg-confirmatory --candidate-ref <frozen-commit-sha> --arms off,gate --scenarios audit-retention-purge,csv-export-delimiter,retry-idempotency,soft-limit-overage,timezone-daily-rollup,username-collation --reps 8 --user-turns 3 --max-turns 40 --timeout-min 15 --seed 11 --dry-run
node docker/gateguard-effectiveness/run-intent.js --out gg-confirmatory --candidate-ref <frozen-commit-sha> --arms off,gate --scenarios audit-retention-purge,csv-export-delimiter,retry-idempotency,soft-limit-overage,timezone-daily-rollup,username-collation --reps 8 --user-turns 3 --max-turns 40 --timeout-min 15 --seed 11 --model <model> --judge-model haiku --allow-real-provider
node docker/gateguard-effectiveness/run-intent.js --out gg-confirmatory --summarize
node docker/gateguard-effectiveness/run-intent.js --out gg-confirmatory --verify
node --test tests/docker/gateguard-intent.test.js
```

`minus-target` is refused here: it needs the declared targets these scenarios
deliberately lack. Each trial is several billed turns plus one cheap judge call
per user turn.

### Limits of this design

- The simulated user is a model, so disclosure is not perfectly reproducible;
  repetitions, not a single trial, carry the estimate.
- No external independent author has produced a frozen confirmatory corpus yet.
  Absence of `targetQuestions` prevents explicit labels leaking through the
  task file, but does not make authorship blind.
- Historical trial rows and transcript bundles are not committed, so the
  historical aggregate claims cannot be independently re-rendered from this
  repository. New runs write `evidence.json` with input fingerprints and
  artifact checksums. `--verify` detects later file changes; it is not a
  signature or proof of provenance.
- Primary arm comparisons use every valid predeclared scenario/repetition pair.
  Floor/ceiling classifications and hole counts are descriptive secondary
  summaries and must not select the primary comparison subset.
- Telling every arm that the user is reachable raises asking across the board,
  which is the right comparison but not the shipped default.

### Scaling a conversation

Three properties matter once a trial is more than one turn, and only the first
is fully solved.

- **Persisted sessions are cleaned up.** Resuming needs session persistence, so
  Claude writes a transcript folder per trial workspace under its projects
  directory. Isolating that with a per-trial `CLAUDE_CONFIG_DIR` does not work:
  it puts the credentials out of reach and every turn returns "Not logged in",
  which the harness then grades as a `coverage-hole`. The runner therefore keeps
  the real config directory and deletes only the folders its own work root
  created. A trial that is unauthenticated, or whose gated arm edited files with
  no sign of the hook, stops the run rather than being recorded.
- **The gate fires once per file per session, so its influence decays.** The
  hook keeps a `checked` list in session state, and `--resume` keeps one session
  id for the whole conversation. After the first touch of a file the gate passes
  it, so in a long conversation almost all of the gate's effect lands in the
  first turn. `denialsPerTurn` records the denials of each turn separately, so a
  zero following a non-zero reads as the latch rather than as the gate choosing
  to stay quiet. `silence-hole` should be read with that column in view, and the
  hook's `MAX_CHECKED_ENTRIES` pruning can let a file be gated again in a very
  long session.
- **Cost grows faster than turn count.** Each turn is a fresh `claude --print
  --resume`, which replays the conversation so far, so tokens per turn rise as
  the exchange lengthens. `--user-turns 3` means up to four agent invocations
  plus one judge call per answer: a 6-scenario, 3-arm, 3-repetition run is 54
  trials and up to 216 billed invocations, not 54. Raise `--user-turns` only
  with a reason, and read the per-arm cost before scaling repetitions.
