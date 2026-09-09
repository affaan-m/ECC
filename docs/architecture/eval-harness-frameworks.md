# Eval Harness Frameworks

Local capsule, inspection, fixture replay, and receipt building blocks.
Candidate execution and promotion are unavailable.
They live in `scripts/lib/eval-harness/`, ship with a CLI at
`scripts/eval-harness.js`, and have an end-to-end example under
`examples/eval-harness/`. The example runs locally, offline, and inside temporary
directories. It does not merge, deploy, publish, or spend.

```sh
node scripts/eval-harness.js example
```

## Why these five

The harness engineering plan v2 (August 2026) describes a twelve-layer stack.
The part that belongs in the portable ECC package is the contract surface any
harness can install and exercise: record what happened, prove it was not
altered, gate a proposed change behind an external checker, replay tool calls
without re-firing effects, and hand a verifier something it can check without
trusting the producer. The execution gate remains disabled pending a verified OS containment backend.
The other modules expose local utilities, not a trust decision about code.

| Framework | Module | Plan epic | What it gives you today |
| --- | --- | --- | --- |
| Envelope | `envelope.js`, `schemas/capsule-envelope.schema.json` | 01 telemetry and capsule contract | `capsule-envelope/v1`, stable identifiers, effect classes SE0 to SE4, default-deny payload allowlist, secret canaries |
| Capsule | `capsule.js` | 02 local execution capsule | Append-only NDJSON journal, five lineages, sha256 predecessor links, `verify` that fails at the exact entry, byte-stable projection, minimal export bundle |
| Gate | `gate.js`, `gate-child.js` | 03 verification gate | Static source digests and syntactic warnings; all execution entrypoints refuse |
| Replay | `replay.js`, `effect-fence.js` | 04 replay-safe branching | Declared determinism and effect class per tool, content-addressed fixtures, `tool.fixture_missing` fail-closed replay, retired child preload refuses execution |
| Receipt | `receipt.js` | 07 verifiable receipts | Offline receipt over capsule root, entry count, artifact digest, and gate receipt; detached signature interface; verification names the failing check |

Epics 05 (offline self-improvement) and 06 (causal triage and compaction
invariance) are not implemented. They consume the records these five produce.

## Effect classes

Every journal entry, tool declaration, and variant manifest carries one class.

| Class | Meaning | Where it is allowed |
| --- | --- | --- |
| SE0 | Read-only evaluation or schema validation | Everywhere |
| SE1 | Reversible local writes inside the capsule or work root | Journal, gate metadata |
| SE2 | Process or filesystem mutation, no live network writes | Candidate execution unavailable |
| SE3 | Append-only remote evidence publication | Never in replay; trusted record-mode caller controls authorization; refused in replay |
| SE4 | Economic, counterparty, payment, provider, or secret-handling effects | Never in replay; record mode requires the trusted caller to forbid it |

Effect classes are declarations, not OS permissions. Static inspection reports
effect-class expansion but cannot enforce a declaration. The replayer refuses
SE3 and above in replay mode regardless of fixtures; record mode invokes the
caller-supplied implementation up to its configured maximum. Only register
trusted implementations. No JavaScript tool wrapper isolates arbitrary code.

## Capsule journal

A capsule is a directory with `capsule.json`, `journal.ndjson`, and an optional
`projection.json`. Each line of the journal is one canonical-JSON envelope. The
first entry links to sixty-four zeros; every later entry links to the previous
`entry_hash`.

```js
const { capsule } = require('./scripts/lib/eval-harness');
const c = capsule.Capsule.create('.ecc/capsules/run-42', { task_family: 'slugify' });
c.append('plan', 'inspection.start', { task_id: 't01' });
c.append('attempt', 'gate.unavailable', { status: 'blocked', reason: 'gate.isolation_required' });
capsule.verify('.ecc/capsules/run-42');   // { ok, code, failed_at, root_hash }
```

`verify` returns `ok: false` with a stable code and the exact failing index for
a changed byte (`capsule.invalid_entry`), a dropped or swapped entry
(`capsule.reordered` or `capsule.broken_link`), and a partial trailing write
(`capsule.truncated_tail`). The journal digest covers the original bytes;
invalid UTF-8 is rejected as `capsule.non_canonical`. `project` derives stable
content from the verified journal snapshot and validated metadata. `exportBundle`
copies the three capsule files and nothing from the workspace.

Metadata is validated before creation writes and when opening, verifying or
projecting a capsule. IDs use the envelope ID pattern; harness/task family must
be nonempty, and created_at must use the canonical ISO timestamp produced by
Date.toISOString(). Missing, unreadable or malformed metadata returns
`capsule.metadata_invalid`; invalid UTF-8 is also rejected. Every journal entry must match metadata schema,
run_id, capsule_id, harness_version and task_family, or verification returns
`capsule.metadata_mismatch` at that entry. Empty journals have no historical
identity binding; their projection and receipt bind the metadata values.
created_at is shape-checked but is not authenticated by journal entries.

Envelope v1 enforces the scalar payload types declared in
`schemas/capsule-envelope.schema.json`. String fields require strings; number
fields require finite numbers, and integer fields require integers. Only
`exit_code` accepts null. No extra nonnegative restrictions are imposed on these
payload numbers. Omitted append payloads still default to an empty object.
Explicit null, arrays, primitives, exotic objects, accessors, symbol keys and
non-enumerable properties are rejected. Plain data objects with either the normal
or null prototype are accepted. Validation inspects descriptors before reading
values; it does not isolate proxies or arbitrary caller JavaScript.

Retained fields are validated before canary scanning or hashing. Undefined,
non-finite numbers, functions, symbols, BigInt and nested/cyclic objects are
refused instead of coerced, dropped from serialized bytes or recursively scanned.
`redactPayload` adds an `errors` array to its existing result; callers must check
it alongside `dropped` and `findings`. Append reports `capsule.payload_invalid`
without writing a journal entry; the existing finally path releases its owned
lock. Strict unknown payload keys still report `capsule.payload_denied`.
`strict: false` permits dropping unknown keys, but never invalid retained values.
Custom allowlists can narrow v1 fields only, and cannot widen the persisted schema.

Envelope validation also requires its own schema-defined fields and rejects
unknown top-level fields even when the supplied hash has been recomputed. Invalid
stored records return `capsule.invalid_entry` at their journal index. This tightens
acceptance of malformed v1 data: existing nonconforming callers/journals need
explicit correction; no automatic migration or healing is performed. Valid v1
bytes and hashes remain unchanged. Generic key preservation and remaining
non-JSON limitations are described below; neither supplies OS containment.

The generic canonicalizer preserves every selected own enumerable JSON key as an
own data property, including `__proto__`, `constructor` and `prototype`. It does
not invoke an inherited setter while constructing the canonical object. Results
retain their ordinary object prototype. Envelope schema rejection is separate:
an own `__proto__` key is valid generic JSON data but remains an unknown envelope
field. Receipt schema acceptance is unchanged; hashing a field is not permission
from a higher-level schema.

Traversal, key sorting, array handling, undefined omission, JSON.stringify and
UTF-8 hashing retain their prior policy, including JavaScript's ordering of
numeric-looking keys. Schema-valid v1 journal/projection bytes and unaffected
receipt/fixture bytes stay identical. Regression vectors were captured from the
pre-fix implementation, including unsigned and synthetic string-signed receipts.
Verification does not rewrite those stored artifacts.

The earlier canonicalizer omitted own `__proto__` keys, creating hash aliases.
Corrected inputs retaining that key intentionally produce different hashes. An
artifact retaining it with a legacy digest fails existing hash checks; a fixture
lookup does not fall back to the old aliased key. Existing key-free stored bytes
remain readable as those bytes, but cannot authenticate richer original inputs
whose keys were lost. Recovery requires explicit re-recording from a trusted
source or receipt rebuilding/re-signing; there is no automatic rekey, migration,
rewrite, dual-hash acceptance or recovery of already discarded information.

This correction does not define a stricter generic policy for undefined,
functions/symbols, non-finite numbers, sparse arrays, class/toJSON/getter behavior,
cycles, resource limits or hostile proxies. Their prior behavior remains; no
claim of unambiguous hashing for every JavaScript value is made. The envelope's
stricter scalar validation remains a separate layer.

Append operations serialize cooperating writers using an exclusive local
`.append.lock` file. Acquisition uses `wx` and fails immediately with
`capsule.busy` when the path exists, regardless of age or contents. There is no
waiting, retry, PID/age heuristic, or automatic stale unlocking. Under ownership,
each append reloads and verifies the complete journal and metadata, then derives
its sequence and predecessor hash from that snapshot. Preopened handles never
use cached sequence/hash values as authoritative state. Full validation costs
O(journal size) per append; this implementation is intended for small local
journals.

The writer handles short writes until the complete UTF-8 entry has been written,
then fsyncs the journal. The append lock is released in finally on success,
validation refusal, or ordinary I/O exceptions. A zero-progress write returns
`capsule.write_failed`. Release checks the open lock descriptor's device/inode
against the path before unlinking; a detected missing/replaced lock returns
`capsule.lock_lost` and a replacement is preserved. This is cooperative ownership
checking, not atomic protection against an actor replacing paths between syscalls.
The local filesystem must support exclusive file creation and stable identities.

A process crash can leave `.append.lock` behind. Acquisition/cleanup I/O failures
can also leave a lock that was not safely released. Further appends stay busy;
only an operator who has stopped all writers and inspected the capsule should
perform recovery. The library never guesses ownership, removes an old lock,
truncates a tail, or repairs journal bytes automatically.

A write failure may leave a partial entry; later appends verify the journal and
refuse the invalid tail, preserving evidence. A full entry may already exist when
fsync, close or lock release throws. Such a failure is an ambiguous acknowledgement,
not proof of rollback: inspect disk before retrying, or a logical event could be
recorded twice. No transaction, exactly-once retry, parent-directory fsync, or
power-loss durability guarantee is added here.

Create, read/verify, projection, receipt production and export are not serialized
by the append lock. Use quiescent capsules for consistent receipts/exports; there
is no concurrent export guarantee or hostile-filesystem containment. The append
repair does not change the disabled candidate execution boundary.

What the chain does not claim: it does not stop an operator from replacing the
whole log. That is the job of a witnessed transparency log, which is a later,
opt-in layer outside this package.

## Verification gate: unavailable

**Supported candidate execution backends: none, on any OS.** `runGate` and
`runVariant` throw `gate.isolation_required` unconditionally, before reading
configuration, copying files, loading candidate modules, or creating receipts.
`gate run` exits 1 before reading its config or creating a capsule. Direct
`gate-child.js` invocation and the retired `effect-fence.js` preload also refuse
before loading requests or candidate code. Trust flags and caller-supplied
executor objects cannot enable execution. There is no promotion path.

The former directory copy and JavaScript interception did not isolate host
reads, alternate builtin loaders, or filesystem descriptors and promises.
Keeping answers in a parent process did not hide the taskset on disk. The
interception code and staged execution implementation have been removed.
Node's [permission model](https://nodejs.org/api/permissions.html) and
[`vm` module](https://nodejs.org/api/vm.html) are not substitutes for isolation
of malicious code.

A future executor must have a separately reviewed OS containment implementation
and adversarial evidence on each supported OS. At minimum it must:

- Expose only immutable, digested variant files and task inputs in an ephemeral
  filesystem. Host tasksets, answers, credentials, configuration, sockets, and
  other workspaces must be inaccessible, including via links and inherited FDs.
- Enforce network, process, filesystem, and resource restrictions outside the
  candidate runtime, with an unprivileged identity and a bounded lifetime.
- Keep the checker, output/protocol validation, audit channel, and receipt
  creation outside candidate control. Verify the actual runtime policy using
  independent canaries before any candidate starts; refuse unavailable backends.
- Reject failed, timed-out, signalled, incomplete, or malformed baseline runs
  before evaluating candidate improvements. Require a complete unique result
  for each task. Container availability or a caller's `verified: true` assertion
  alone is not policy verification.

Static APIs remain available for trusted, quiescent local source trees:
`loadTaskset`, `loadVariant`, `digestDir`, and `scanTripwires`. Variant names are
single components of 1–64 ASCII letters, digits, underscores or hyphens, starting
with a letter or digit. Entries must be relative regular files included in the
digest; absolute, parent-traversing, symlinked, and excluded entries are rejected.
`.git` and `node_modules` remain excluded. Inspection does not resist concurrent
host filesystem mutation and is not a sandbox or an execution attestation.
Task IDs must be unique. Syntactic warnings are incomplete by design: zero hits
prove neither safety nor correctness.

`parseChildResult` and `baselineFailure(run, tasks)` are pure validation helpers
for bounded protocol and baseline integrity regression checks. No executor calls
them in this release. Their tests are not evidence of an operational gate or a
verified OS backend. Existing manifest/config fixtures are preserved as data.

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
`tool.fixture_mismatch`. Record mode executes caller-supplied trusted functions;
replay uses fixtures. These wrappers do not constrain arbitrary effects inside
an implementation. The legacy `EFFECT_FENCE_PRELOAD` export remains for import
compatibility, but loading that file always throws `gate.isolation_required`.
It no longer attempts JavaScript interception.

## Offline receipts

```sh
node scripts/eval-harness.js receipt build .ecc/capsules/run-42 \
  --artifact skills/my-skill/SKILL.md --out run-42.receipt.json
node scripts/eval-harness.js receipt verify run-42.receipt.json exported-bundle/ \
  --artifact skills/my-skill/SKILL.md
```

A receipt names the capsule root, entry count, journal digest, projection
hash, artifact digest, and optional gate receipt digest, plus its own hash.
`buildReceipt` now persists `projection.json` using the verified journal snapshot
before returning the receipt. This is a producer write and can fail on a read-only
capsule; copy a read-only source to a writable local directory before building.
An explicit invalid artifact_digest throws `receipt.schema_invalid` before the
projection write. Other construction failures continue to throw.

`verifyReceipt` is read-only. It never regenerates or heals a missing projection.
The supplied projection must parse and match the complete deterministic projection
from the validated metadata/journal snapshot; its computed hash must match both
its stored projection_hash and the receipt. Missing, unreadable, corrupt or
substituted projections return `check: 'projection'`; invalid UTF-8 is rejected. Receipt identity mismatches
and invalid capsule metadata return `check: 'metadata'`.

Schema validation rejects negative, fractional, string or unsafe entry counts,
invalid identity/schema values and malformed required digests before journal
indexing. Optional artifact/gate digest fields must be SHA-256 values or null.
Otherwise valid receipts retain signature, journal integrity, truncation,
capsule-root and stale-checkpoint checks before projection/artifact comparisons.
Missing or unreadable artifact files return `check: 'artifact'` rather than
throwing. Every verification failure has `{ok: false, check, reason}` for these
validated file/content cases.

Existing v1 exported bundles retain their format. Older source directories whose
receipts were built without a saved projection must explicitly run `capsule
project` or rebuild the receipt before verification; verification itself never
writes a replacement. The CLI validates --artifact, --gate and --out before file
reads or producer writes: missing values, values that are another flag, and
repeated flags exit with usage code 2. Disabled gate commands still refuse before
configuration/capsule I/O.

Signing remains a detached interface: pass a signer when building and a verifier
when verifying. No key generation, transport or rotation happens in this package.
A signature proves who vouched for the bytes, not that the run was correct.
Optional gate-receipt hashing remains for compatibility with existing artifacts;
accepting externally supplied bytes proves neither containment nor promotion.

This slice addresses receipt/projection validation and metadata identity binding.
The OS executor is still unavailable. Cooperative append serialization is
described above; concurrent export/create and broader envelope/review findings
remain separate. Package/count evidence is a separate ignore-scripts test scope
and does not validate normal prepack or clear a release.

## Where it plugs in

- `skills/eval-harness/SKILL.md` describes eval-driven development. These
  frameworks are the mechanical layer under its report format.
- The `harness-optimizer` agent and `/harness-audit` command must report the gate
  unavailable until a reviewed OS backend exists. They cannot emit new gate
  receipts using this implementation.
- The Rust `ecc2/src/harness_eval.rs` bounded evaluation loop is a separate,
  earlier experiment. The Node frameworks are the portable surface.

## Tests

```sh
node tests/lib/eval-harness/envelope.test.js
node tests/lib/eval-harness/capsule.test.js
node tests/lib/eval-harness/gate.test.js
node tests/lib/eval-harness/security.test.js
node tests/lib/eval-harness/replay.test.js
node tests/lib/eval-harness/receipt.test.js
node tests/lib/eval-harness/cli.test.js
node examples/eval-harness/run-example.js
```
