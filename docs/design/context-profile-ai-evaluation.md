# Context profile AI evaluation

This development-only evaluator measures whether Lean with Auto selection completes real
coding tasks as well as Full. It lives in `docker/context-profiles/` and is not part of
the published npm package. No provider call occurs without an injected test provider or
the explicit `--allow-real-provider` flag. Reports never approve a release on their own.

## What it compares

`docker/context-profiles/ai-corpus.json` fixes 30 small coding tasks and at least 30
selection probes before execution. Each task is a tiny CommonJS workspace with a bug or
missing behavior; about two thirds benefit from a specific ECC skill and the rest need
none, including tasks with misleading workflow vocabulary. Each task carries a hidden
grader that the agent never sees.

Every task runs in all three arms, in separate fresh workspaces with identical files.
Arm order rotates by task and repeat to reduce fixed ordering effects.

| Arm | Codex install | ECC task context |
| --- | --- | --- |
| Full | Real Full install: every skill natively discoverable | None; the host chooses from its own catalog |
| manual Lean | Real Lean install: three-entry core | The task's preregistered skill, loaded by the launcher |
| Auto Lean | Same Lean install | The resolver's shortlist plus one bounded agent proposal |

Both installs are prepared through the isolated native adapter (`applyStore` then
`prepareNativeProfile`), the same path users get. Before every call the evaluator
re-verifies the install's recorded inventory and stops with `environment-drift` if
Codex changed discovery configuration or skill bytes. Full therefore measures today's
native experience, including its real startup context, rather than a simulated catalog.

## Hidden grading

After the agent exits, the evaluator writes the grader into the workspace and runs it
with Node. Exit zero passes. An agent that plants its own grader file fails. On Node 20
and later the grader runs under Node's permission model with read access limited to the
workspace, so it cannot write files, spawn processes or start workers. Network access is
not restricted by that model; run live evaluations inside the Tier 1 sandbox when that
matters. Provider exit status and claimed success alone never pass a task.

`tests/lib/context-profile-eval-corpus.test.js` proves every grader fails on the initial
files and passes on an independent reference solution kept in
`tests/fixtures/context-eval-references.json`, which is never shown to the agent.

## Setup with a ChatGPT subscription

The Codex adapter supports exactly Codex 0.154.0 and 0.155.1. Install a pinned copy
next to, not over, your everyday Codex:

```sh
npm install --prefix ~/.ecc-eval/codex @openai/codex@0.155.1
```

Create a dedicated login home and sign in once. The file credential store keeps the
login in `auth.json`, which the evaluator can lease:

```sh
mkdir -m 700 -p ~/.ecc-eval/auth
CODEX_HOME=~/.ecc-eval/auth ~/.ecc-eval/codex/node_modules/.bin/codex login \
  -c 'cli_auth_credentials_store="file"'
chmod 600 ~/.ecc-eval/auth/auth.json
```

For each call, the evaluator copies `auth.json` into the isolated install's
`CODEX_HOME`, runs Codex, writes any refreshed tokens back to the login home, and always
deletes the copy. It refuses a login home that is your own `~/.codex` or `CODEX_HOME`,
or that other users can read. It never reads your everyday Codex home. Calls run
sequentially, so refreshed tokens cannot race. Usage counts against your subscription's
rate limits. `CODEX_API_KEY` remains an alternative when no `--auth-home` is given.

## Running

Register first, then execute against the retained registration:

```sh
CODEX=$(realpath ~/.ecc-eval/codex/node_modules/@openai/codex/bin/codex.js)
node docker/context-profiles/ai-eval.js --plan \
  --executable "$CODEX" --model YOUR_PINNED_MODEL > /tmp/ecc-ai-registration.json
node docker/context-profiles/ai-eval.js --allow-real-provider \
  --registration /tmp/ecc-ai-registration.json \
  --executable "$CODEX" --model YOUR_PINNED_MODEL \
  --auth-home ~/.ecc-eval/auth > /tmp/ecc-ai-metrics.json
```

The registration binds corpus bytes, registry resource digests, both profile plans,
evaluator, launcher, resolver and native adapter digests, model and executable
fingerprints, case order, repeats and analysis thresholds. A changed source stops
execution. Repeated sampling requires the same `--repeats N` at registration and
execution. A changed corpus is a new experiment, never a silent replacement for failed
cases.

Defaults are 300 provider calls, a one-hour overall deadline and five minutes per task
call. Hard limits are 2,000 calls, four hours and ten minutes per call. Proposal calls
retain the launcher's tighter timeout. A single pass of the bundled corpus makes about
90 task calls plus up to one proposal call per Auto task and selection probe. Every
scheduled outcome remains in the denominator after a budget, deadline, provider, drift
or grading failure. Workspaces and installs are removed in `finally`.

## Metrics and statistical limits

The JSON report is built from an allowlist: case IDs, arm, repeat, pass/fail, controlled
failure codes, selected skill IDs, digests, call counts, elapsed time, numeric usage,
install skill counts and the authentication mode. Transcripts, prompts, paths, stderr
and credentials are never emitted or persisted. Valid usage requires one
`turn.completed` record with nonnegative integer input, cached-input and output
counters. Missing or malformed usage is unknown, never zero.

Selection accuracy includes a descriptive 95% Wilson interval. Paired pass-rate
differences against Full use a conservative bounded Hoeffding interval with Bonferroni
correction across the two comparisons. Repeats are averaged within distinct task IDs
first, so repeating tasks never creates new independent tasks. The corpus is purposive,
so no production population generalization is justified.

The preregistered minimum is 30 distinct tasks and 30 selection cases, with a
five-percentage-point noninferiority margin. With 30 tasks the Hoeffding interval is
still wide, so a first live run is expected to report `review-required` without
supporting noninferiority. Use its observed variance to size the next corpus.

## Deterministic verification

```sh
node --test tests/lib/context-profile-eval.test.js tests/lib/context-profile-eval-corpus.test.js
node docker/context-profiles/ai-eval.js --plan
```

Injected providers validate the measurement path, isolation, grading, lease handling
and sanitization. A passing synthetic run validates the framework, never model quality.
A valid CLI report exits zero even when cases fail or the sample is insufficient;
consumers must inspect case results and the gate.
