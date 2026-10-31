# Eval Harness Example

```sh
node scripts/eval-harness.js example
# Keep the temporary artifacts for inspection:
node examples/eval-harness/run-example.js --keep
```

The example verifies that candidate execution is unavailable, inspects source
without loading it, records and replays a locally declared fixture function,
and builds an offline capsule receipt. It changes a journal value in a copy
and checks that verification detects the changed entry. All five capsule
lineages describe these observations; none represent a scored candidate run.

**Supported candidate execution backends: none.** `gate run`, `runGate`,
`runVariant`, `gate-child.js`, and the retired `effect-fence.js` preload refuse
with `gate.isolation_required`. No `trusted_local`, `--trusted-local`, or
caller-supplied isolation claim enables execution. The example emits no gate
receipt, score, or promotion verdict.

With `--keep`, inspect `capsule/journal.ndjson`, `capsule/projection.json`,
`fixtures/`, and `bundle/receipt.json` in the printed work directory.

| Path | Purpose |
| --- | --- |
| `taskset.json` | Twelve slugify tasks for static inspection, three marked held out |
| `gate.config.json` | Preserved gate input example; `gate run` currently refuses it |
| `variants/baseline` | Known-weak source fixture; never executed by this example |
| `variants/candidate` | Honest source fixture; never executed by this example |
| `variants/reward-hack` | Source fixture with visible syntactic warnings |

See `docs/architecture/eval-harness-frameworks.md` for the OS containment
requirements and the limits of static inspection and receipt verification.
