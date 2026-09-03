# Eval Harness Frameworks

Runnable building blocks for evaluating a harness change before it is trusted.
They live in `scripts/lib/eval-harness/`, ship with a CLI at
`scripts/eval-harness.js`, and have an end-to-end example under
`examples/eval-harness/`. Everything runs locally, offline, and inside temporary
directories. Nothing here merges, deploys, publishes, or spends.

```sh
node scripts/eval-harness.js example
```

## Why these five

The harness engineering plan v2 (August 2026) describes a twelve-layer stack.
The part that belongs in the portable ECC package is the contract surface any
harness can install and exercise: record what happened, prove it was not
altered, gate a proposed change behind an external checker, replay tool calls
without re-firing effects, and hand a verifier something it can check without
trusting the producer. These five frameworks are the first deployable slices of
that surface, in dependency order.

| Framework | Module | Plan epic | What it gives you today |
| --- | --- | --- | --- |
| Envelope | `envelope.js`, `schemas/capsule-envelope.schema.json` | 01 telemetry and capsule contract | `capsule-envelope/v1`, stable identifiers, effect classes SE0 to SE4, default-deny payload allowlist, secret canaries |
| Capsule | `capsule.js` | 02 local execution capsule | Append-only NDJSON journal, five lineages, sha256 predecessor links, `verify` that fails at the exact entry, byte-stable projection, minimal export bundle |
| Gate | `gate.js`, `gate-child.js` | 03 verification gate | Smoke, selection, and held-out stages; checker runs outside the candidate's scope; syntactic tripwires; promotion receipt with rollback target |
| Replay | `replay.js`, `effect-fence.js` | 04 replay-safe branching | Declared determinism and effect class per tool, content-addressed fixtures, `tool.fixture_missing` fail-closed replay, network and write fence for child processes |
| Receipt | `receipt.js` | 07 verifiable receipts | Offline receipt over capsule root, entry count, artifact digest, and gate receipt; detached signature interface; verification names the failing check |

Epics 05 (offline self-improvement) and 06 (causal triage and compaction
invariance) are not implemented. They consume the records these five produce.

## Effect classes

Every journal entry, tool declaration, and variant manifest carries one class.

| Class | Meaning | Where it is allowed |
| --- | --- | --- |
| SE0 | Read-only evaluation or schema validation | Everywhere |
| SE1 | Reversible local writes inside the capsule or work root | Journal, gate metadata |
| SE2 | Sandboxed process or filesystem mutation, no live network writes | Gate candidate runs |
| SE3 | Append-only remote evidence publication | Never inside these frameworks; refused in replay |
| SE4 | Economic, counterparty, payment, provider, or secret-handling effects | Never; refused everywhere |

The gate rejects a variant whose declared class exceeds the gate maximum before
any score is compared. The replayer refuses SE3 and above regardless of
fixtures. Money-touching tools never get permissive replay.

## Capsule journal

A capsule is a directory with `capsule.json`, `journal.ndjson`, and an optional
`projection.json`. Each line of the journal is one canonical-JSON envelope. The
first entry links to sixty-four zeros; every later entry links to the previous
`entry_hash`.

```js
const { capsule } = require('./scripts/lib/eval-harness');
const c = capsule.Capsule.create('.ecc/capsules/run-42', { task_family: 'slugify' });
c.append('plan', 'gate.start', { task_id: 't01' });
c.append('attempt', 'gate.smoke', { passed: 3, total: 3, status: 'pass' }, { effect_class: 'SE2' });
capsule.verify('.ecc/capsules/run-42');   // { ok, code, failed_at, root_hash }
```

`verify` returns `ok: false` with a stable code and the exact failing index for
a changed byte (`capsule.invalid_entry`), a dropped or swapped entry
(`capsule.reordered` or `capsule.broken_link`), and a partial trailing write
(`capsule.truncated_tail`). `project` rebuilds the same bytes from the same
journal every time. `exportBundle` copies the three capsule files and nothing
from the workspace.

What the chain does not claim: it does not stop an operator from replacing the
whole log. That is the job of a witnessed transparency log, which is a later,
opt-in layer outside this package.

## Verification gate

A gate config names a taskset, a baseline variant, and a candidate variant.

```json
{
  "taskset": "taskset.json",
  "baseline": "variants/baseline",
  "candidate": "variants/candidate",
  "max_effect_class": "SE1",
  "thresholds": { "smoke_tasks": 3, "min_pass_rate": 0.9, "max_regressions": 0 }
}
```

A variant is a directory with `variant.json` (`name`, `effect_class`, optional
`entry`) and a module exporting `solve(input)`. The runner copies the variant
into a fresh sandbox, writes a random marker, and spawns it with the effect
fence preloaded and a minimal environment. The child receives task inputs only.
Expected outputs stay in the parent process, which is the checker.

Stages run in order and stop at the first failure: smoke (the first few
held-in tasks), selection (all held-in tasks), then held-out tasks. The
receipt records per-task results for baseline and candidate, regressions
(baseline pass, candidate fail), tripwire hits with file and line, effect
fence events, marker integrity, the verdict, the reasons, and the baseline
digest as the rollback target.

Default tripwires: hidden network modules or `fetch`, process spawning,
sandbox weakening (`Module._load`, `NODE_OPTIONS`, the fence's own names),
checker probing (`taskset`, `.gate-marker`, `ECC_GATE_`), parent-directory
escapes, and effect-class expansion. The example's reward-hack variant scores
the same as the honest candidate and is still rejected.

Non-goals: no automatic merge or release, no online self-editing, and no
claim that a twelve-task set measures small deltas precisely. The receipt
carries a `nondeterminism` field so a reviewer knows it was a single run.

## Replay-safe tool calls

```js
const { replay } = require('./scripts/lib/eval-harness');
const store = new replay.FixtureStore('.ecc/fixtures');
const tools = {
  read_inventory: { effect_class: 'SE0', determinism: 'deterministic', impl: liveRead },
  place_order: { effect_class: 'SE4', determinism: 'nondeterministic', impl: livePlace },
};
const r = replay.createReplayer(tools, { mode: 'replay', store, maxEffectClass: 'SE2' });
r.call('read_inventory', { sku: 'gpu-8x' });   // served from fixture or tool.fixture_missing
r.call('place_order', { sku: 'gpu-8x' });      // tool.effect_forbidden, always
```

Fixtures are keyed by the canonical hash of `(tool, args)` and store both an
argument hash and a response hash, so a stale or edited fixture fails with
`tool.fixture_mismatch`. The effect fence (`effect-fence.js`) is a `--require`
preload for child processes: it blocks `http`, `https`, `net`, `tls`,
`dgram`, `dns`, `http2`, `child_process`, and `fetch`, refuses writes outside
the sandbox root, and appends every attempt to a canary log the parent reads
after the run.

## Offline receipts

```sh
node scripts/eval-harness.js receipt build .ecc/capsules/run-42 \
  --artifact skills/my-skill/SKILL.md --gate work/gate-receipt.json --out run-42.receipt.json
node scripts/eval-harness.js receipt verify run-42.receipt.json exported-bundle/ \
  --artifact skills/my-skill/SKILL.md --gate work/gate-receipt.json
```

A receipt names the capsule root, entry count, journal digest, projection
hash, artifact digest, and gate receipt digest, plus its own hash. Verification
checks, in order: schema, receipt hash, signature (when a verifier is
supplied), journal presence, journal integrity, truncation, capsule root,
stale checkpoint, journal bytes, artifact, gate receipt. The first failing
check is named. Signing is a detached interface: pass a `signer` when
building and a `verifier` when verifying. No key generation, transport, or
rotation happens in this package, and a signature proves who vouched for the
bytes, not that the run was correct.

## Where it plugs in

- `skills/eval-harness/SKILL.md` describes eval-driven development. These
  frameworks are the mechanical layer under its report format.
- The `harness-optimizer` agent and `/harness-audit` command can emit gate
  receipts for a proposed harness edit instead of a prose verdict.
- The Rust `ecc2/src/harness_eval.rs` bounded evaluation loop is a separate,
  earlier experiment. The Node frameworks are the portable surface.

## Tests

```sh
node tests/lib/eval-harness/envelope.test.js
node tests/lib/eval-harness/capsule.test.js
node tests/lib/eval-harness/gate.test.js
node tests/lib/eval-harness/replay.test.js
node tests/lib/eval-harness/receipt.test.js
node examples/eval-harness/run-example.js
```
