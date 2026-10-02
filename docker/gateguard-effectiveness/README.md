# GateGuard question effectiveness

Development-only harness that runs real Claude sessions on trapped coding
tasks with and without GateGuard's questions. Design, arms, measures and
results: [docs/gateguard/question-effectiveness.md](../../docs/gateguard/question-effectiveness.md).

```bash
node docker/gateguard-effectiveness/run.js --out gg-eff --dry-run
node docker/gateguard-effectiveness/run.js --out gg-eff --model <model> --allow-real-provider
```
