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
agent that does not ask can only guess. Scenarios are authored blind to the
gate's question taxonomy, and the report classifies each trial into a hole worth
fixing.

```bash
node docker/gateguard-effectiveness/run-intent.js --check-graders
node docker/gateguard-effectiveness/run-intent.js --out gg-intent --arms off,gate --dry-run
node docker/gateguard-effectiveness/run-intent.js --out gg-intent --model <model> --allow-real-provider
node docker/gateguard-effectiveness/run-intent.js --out gg-intent --summarize
```
