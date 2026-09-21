# Context profile AI evaluation pilot

This source-only evaluation compares concrete artifact outcomes with the existing
launcher and resolver. It does not change those APIs, install a profile, or certify
native workflow invocation. No provider call occurs without an injected test
provider or the explicit `--allow-real-provider` flag.

## Preregistered design

`docker/context-profiles/ai-corpus.json` fixes 13 selection probes and eight artifact
tasks before execution. Selection covers exact names, paraphrases, irrelevant
arithmetic, misleading workflow vocabulary, explicit opt-out, exclusion,
conflicting opt-out, unknown IDs, and native-authority rejection. The task set
covers stable aggregation, pagination exhaustion, strict text extraction, numeric
boundary partitions, instruction-like untrusted data, and three no-workflow cases.
These are deliberately small, purposively selected cases. They are representative
of routing situations, not a statistically representative production population.

Every task runs in all three arms, in separate fresh workspaces with identical
input. Arm order rotates by task and repeat to reduce fixed ordering effects.

| Arm | Discovery data supplied to task call | Workflow selection |
| --- | --- | --- |
| Full | Full registry metadata | Preregistered explicit IDs |
| manual Lean | Lean kernel metadata | Same preregistered explicit IDs |
| Auto Lean | Lean kernel metadata | Explicit IDs or a bounded admitted agent proposal |

The Full baseline therefore measures full discovery overhead against a known
manual workflow choice. It does not load every workflow body. Discovery metadata
is supplied as prompt reference data, since the current launcher does not render
native discovery catalogs. Loaded bodies and dependencies still come exclusively
from `launchTaskContext`. Auto proposal cost is included in task totals. Separate
selection probes use `resolveTaskContext` and `proposeTaskContext` directly and do
not count toward paired outcome sample size.

Preregistration also binds the exact Node runtime and the pinned `ajv` and
`js-yaml` dependency versions used by validation and profile parsing. A runtime
or dependency change therefore invalidates retained registration before calls.

Each task must produce `result.json`. The evaluator reads that artifact after the
provider exits, compares it against independent closed-set assertions, and checks
that input bytes survived. Provider exit status, claimed success, and correct
workflow selection alone cannot pass an outcome. Expected artifacts are absent
from provider inputs. These are bounded data-processing and reasoning outcomes,
not evidence of broad software implementation ability or security containment.
Extending tasks requires updating the independent assertions and versioning the
corpus before gathering new evidence.

## Pins and execution

Generate and retain registration before enabling provider work:

```sh
node docker/context-profiles/ai-eval.js --plan \
  --executable /absolute/path/to/codex --model YOUR_PINNED_MODEL \
  > /tmp/ecc-ai-registration.json
node docker/context-profiles/ai-eval.js --allow-real-provider \
  --registration /tmp/ecc-ai-registration.json \
  --executable /absolute/path/to/codex --model YOUR_PINNED_MODEL \
  --max-calls 80 --deadline-ms 600000 > /tmp/ecc-ai-metrics.json
```

The registration binds corpus bytes semantically using canonical JSON, registry
resource digests, both profile plans, evaluator and launch/resolver implementation
digests, model and executable fingerprints, case order, repeats, and analysis
thresholds. A plan without model/executable options is an offline preview and
cannot authorize live execution. A changed registration or
source stops execution. Repeated sampling requires the same `--repeats N` at
registration and execution. A changed corpus is a new experiment, never a silent
replacement for failed cases.

Use an actual Codex executable supporting `exec --json`, `--ephemeral`,
`--ignore-user-config`, and `--ignore-rules`. Authentication must be explicitly
provisioned by the operator as `CODEX_API_KEY` in the evaluation environment.
The runner forwards that variable only to the opted-in subprocess, never writes
it, never copies auth files, and never uses the user's existing Codex home.
Each call uses a disposable home, a disposable cwd, and an allowlisted environment.
Selection is read-only; artifact execution uses workspace-write with approval
policy `never`. The parent sandbox runner owns stronger process/network isolation.
A disposable cwd is not itself a security boundary.

Defaults are 80 provider calls, a ten-minute overall execution deadline, and at
most two minutes per call. Proposal calls retain the launcher's tighter timeout.
Hard limits are 2,000 calls, one hour, and 120 seconds per call. Calls use bounded
stdout/stderr buffers and kill on timeout. No retries are hidden in the evaluator.
Codex/provider internal request retries are outside this process-call accounting.
Every scheduled outcome remains in the denominator after a budget, deadline,
provider, or assertion failure. Workspaces are removed in `finally`.

## Metrics and statistical limits

The JSON report is built from an allowlist: case IDs, arm, repeat, pass/fail,
controlled failure codes, admitted skill IDs, digests, call counts, elapsed time,
and numeric usage. Transcripts, prompts, paths, stderr, credentials, and model
messages are never emitted or persisted by the evaluator. JSONL exists only in
bounded process memory. Valid usage requires one `turn.completed` record with
nonnegative integer input, cached-input and output counters. Cached input is a
subset of input, not an additive extra. Missing/malformed usage is unknown,
never zero. Provider usage covers the observed invocation, including tool-turn
context if reported by Codex; it is not a native discovery-only token counter.

Selection accuracy includes a descriptive 95% Wilson interval. Paired pass-rate
differences against Full use a conservative bounded Hoeffding interval, with
Bonferroni correction across the two comparisons. Repeats are first averaged
within distinct task IDs. Repeating eight tasks never creates 30 independent
tasks. These intervals are descriptive under a purposive corpus; no production
population generalization is justified.

The preregistered minimum is 30 distinct tasks and 30 selection cases, with a
five-percentage-point noninferiority margin. The bundled pilot necessarily reports
`insufficient-sample`, even for perfect results. Injected-provider evidence cannot
establish real model quality. Reports never automatically approve a release.
A larger independently chosen corpus, actual provider observations, adequate
precision, and human review are required for claims beyond this pilot.

## Deterministic verification

```sh
node --test tests/lib/context-profile-eval.test.js
node docker/context-profiles/ai-eval.js --plan
```

`runEvaluation({ provider })` accepts a synchronous provider returning the same
`{ status, stdout, error? }` envelope as `spawnSync`; stdout is Codex JSONL. The
request contains phase, input, disposable cwd/home, timeout and output bound.
Injected code is trusted test code and must honor its timeout; JavaScript cannot
preempt a blocking in-process function. Tests write artifacts independently and
cover incorrect success claims, cleanup, usage parsing, pin mismatch, budgets,
confidence intervals, CLI rejection, and opt-in enforcement. A passing synthetic
run validates the framework, never the model's efficacy.

## Initial deterministic findings

The initial resolver selected `skill:security-review` for literal workflow words.
The integration removes unconditional name admission and adds a negative skill
mention to the fixed pilot. Both now require the agent to decide whether context
is useful. Synthetic outcomes validate the measurement path and assertions only.
No live provider outcomes have been collected; the pilot gate stays
`insufficient-sample`. Credential preflight fails before the first real call when
the disposable environment has no `CODEX_API_KEY`.

A valid CLI report exits zero even when cases fail or the sample is insufficient.
Consumers must inspect the report's case results and gate. Argument, configuration
and preregistration failures exit one with a sanitized message.
