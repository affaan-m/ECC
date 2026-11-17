# GateGuard question effectiveness

Development-only harness that runs real Claude sessions on trapped coding
tasks with and without GateGuard's questions. Design, arms, measures and
results: [docs/gateguard/question-effectiveness.md](../../docs/gateguard/question-effectiveness.md).

Two runners, measuring different things.

`run.js` — cost baseline. One-shot autonomous sessions over `scenarios/`, where
each trap hides its deciding fact in the repository. The pilot returned no
outcome difference between any arm, so treat this as a measure of the gate's
turn and token cost, not of its effect.

```bash
node docker/gateguard-effectiveness/run.js --out gg-eff --dry-run
node docker/gateguard-effectiveness/run.js --out gg-eff --model <model> --allow-real-provider
```

`run-intent.js` — effectiveness. Multi-turn sessions over `scenarios-intent/`,
where the deciding fact exists only in a simulated user's hidden intent, so an
agent that does not ask can only guess. Scenario files omit declared gate
question targets, but this does not establish blind or independent authorship:
the authors knew the taxonomy, and the external-contract question was added
after inspecting this corpus. Treat those results as exploratory. That question
is now opt-in (`GATEGUARD_EXTERNAL_CONTRACT_QUESTION`), and the runner clears
every `GATEGUARD_*` variable from the agent's environment, so a `gate` arm
built from a current candidate tree runs without it. The report classifies
behavior into descriptive hole categories.

Each run writes `meta.json`, raw `results.jsonl`, transcripts, `summary.json`,
`holes.md`, and `evidence.json`. The evidence manifest fingerprints the frozen
scenario and harness inputs and hashes the output artifacts. Verify an output
directory with `--verify`; this detects later file changes but is not a
cryptographic signature or proof of who ran the experiment.

`run-intent.js --check-graders`, and each intent run before it bills a session, requires each
grader to score `reference` 1 and the start workspace, the `naive` trap and every
`decoy-*` overlay below 1. A decoy has the right shape and the wrong content, so
a grader that checks only the form fails the check. Both runners count only valid
trials: authentication-related provider errors stop the run before the attempt
is appended to `results.jsonl`. The transcript is retained, but there is no
attempt record. Other provider-error or timeout attempts stay in `results.jsonl`
with their own transcripts, are reported apart, and are retried on resume.
A gated trial whose hook never ran also stops the run without a `results.jsonl`
record.

```bash
node docker/gateguard-effectiveness/run-intent.js --check-graders
node docker/gateguard-effectiveness/run-intent.js --out gg-intent --arms off,gate --dry-run
node docker/gateguard-effectiveness/run-intent.js --out gg-intent --model <model> --allow-real-provider
node docker/gateguard-effectiveness/run-intent.js --out gg-intent --summarize
node docker/gateguard-effectiveness/run-intent.js --out gg-intent --verify
```

The one-shot `run.js` runner serializes an output directory with `.run.lock`; concurrent workers
must use separate `--out` directories. Normal completion and errors release the
lock. After a killed process, confirm that its worker has stopped before removing
the stale lock and resuming. Metadata uses private exclusive temporary creation
and atomic rename so a destination symlink cannot redirect metadata writes.

Hidden-intent trials retain the selected Claude configuration directory and pass
`--claude` to both the agent and simulated user. Session cleanup removes only new
project folders matching workspaces observed inside that trial's temporary root;
pre-existing folders and concurrent runs remain. Shared project-name overrides
remain untouched because they do not establish exclusive trial ownership.
`arm-patch.js` is included in frozen harness fingerprints, so changes to ablations
require a new output directory rather than continuing an existing experiment.
