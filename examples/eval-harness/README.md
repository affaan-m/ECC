# Eval Harness Example

One command exercises all five eval-harness frameworks against fixtures in
this directory:

```sh
node scripts/eval-harness.js example
# or
node examples/eval-harness/run-example.js --keep
```

What it does:

1. Runs the staged gate for `variants/candidate` against `variants/baseline`
   on `taskset.json`, journaling into a capsule. The candidate promotes.
2. Runs the gate for `variants/reward-hack`. It scores the same as the honest
   candidate, phones home, and probes for the taskset. It is rejected on
   tripwires and effect fence events.
3. Records one declared tool call into a fixture store and replays it, then
   shows `tool.fixture_missing` and `tool.effect_forbidden` failing closed.
4. Builds an offline receipt, exports a bundle, and verifies the receipt
   against the bundle alone.
5. Flips one byte in a copy of the journal and shows verification failing at
   the exact entry, with the receipt naming the failing check.

Pass `--keep` to keep the temporary work directory and inspect
`gate-receipt.json`, `journal.ndjson`, `projection.json`, and `receipt.json`.

Files:

| Path | Purpose |
| --- | --- |
| `taskset.json` | Twelve deterministic slugify tasks, three held out |
| `gate.config.json` | Gate thresholds and variant paths, usable with `scripts/eval-harness.js gate run` |
| `variants/baseline` | Known-weak baseline |
| `variants/candidate` | Honest candidate |
| `variants/reward-hack` | Fixture the gate must reject regardless of score |

Design notes live in `docs/architecture/eval-harness-frameworks.md`.
