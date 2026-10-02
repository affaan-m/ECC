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

Not run yet.
