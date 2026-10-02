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

**Scenarios are authored blind.** `task.json` must not declare
`targetQuestions`; the loader rejects it. Which questions a scenario provokes is
observed from the run and reported.

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

### First hidden-intent run

Four trials, `off` and `gate`, two repetitions, sonnet under test and haiku as
the user:

| Arm | working | lucky | follow-through | targeting | silence | coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `gate` | 1 | 0 | 0 | 0 | 1 | 0 |
| `off` | 0 | 0 | 0 | 0 | 0 | 2 |

`gate` passed 1 of 2 and `off` 0 of 2, so the scenario separates the arms where
the original six did not. Four trials settle nothing about the effect size; what
they show is that the instrument now has a scale.

The questions the gate actually raised on this scenario were `config-effect`,
`config-reader`, `data-schema`, `importers`, `no-plaintext-secrets`,
`public-api` and `quote-instruction` — seven questions, none of which asks about
a retention window or whether a delete is soft. In the one `silence-hole` trial
the gate fired and the agent proceeded without asking anyway. Both are
improvable gaps, and neither was expressible in the previous design.

### Reproduce

```bash
node docker/gateguard-effectiveness/run-intent.js --check-graders
node docker/gateguard-effectiveness/run-intent.js --out gg-intent --arms off,gate --dry-run
node docker/gateguard-effectiveness/run-intent.js --out gg-intent --model <model> --allow-real-provider
node docker/gateguard-effectiveness/run-intent.js --out gg-intent --summarize
node --test tests/docker/gateguard-intent.test.js
```

`minus-target` is refused here: it needs the declared targets these scenarios
deliberately lack. Each trial is several billed turns plus one cheap judge call
per user turn.

### Limits of this design

- The simulated user is a model, so disclosure is not perfectly reproducible;
  repetitions, not a single trial, carry the estimate.
- One scenario is not a corpus. The blind-authoring rule is only as good as the
  independence of whoever writes the next ones.
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
