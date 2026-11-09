# Copilot telemetry and skill-health evidence

P04 metadata collection is disabled by default. Set
`ECC_COPILOT_TELEMETRY=1` in operator-controlled environment configuration to
enable recording. Disabling it performs no writes and preserves earlier data.
It is independent of transcript summaries and learning observations.

The bounded per-project store is `telemetry.jsonl` below the resolved Copilot
configuration root. It uses the existing canonical workspace mapping, an
exclusive writer lock, atomic replacement and owner-only file creation. Maximum
retention is 30 days on subsequent writes, at most 2,000 records and 1 MiB.
Retention is not a background deletion timer. Malformed, future-version,
partial, linked or oversized stores return an error instead of a healthy empty
report. A lock conflict is unavailable collection, never successful recording.

| Fact | Meaning | Does not establish |
| --- | --- | --- |
| discovered | Explicit host discovery signal | Selection or execution |
| selected | Explicit host selection signal | Invocation |
| invoked | Explicit host invocation signal | Completion |
| completed | Explicit host success signal | Quality of produced code |
| failed | Explicit host failure signal | Failure of unrelated calls |
| unknown | Completion without usable outcome | Success or failure |
| hook metric | Measured hook duration and process status | Tool or skill success |

No installed-file scan, skill citation, prompt text or generic file read creates
a skill invocation. The [native journal adapter](COPILOT-NATIVE-SKILL-TELEMETRY.md)
imports explicit persisted `skill.invoked` facts with bounded qualified identities.
User/agent invocation increments `invoked`; context preloading increments only
`selected`. It does not infer completed/failed outcomes. Absent or ephemeral
signals are reported unavailable, never as zero usage. Native model-authenticated
emission and Windows delivery remain unverified even though the primary SDK
schema and fixtures support this adapter.

Skill facts deduplicate by project/session/call/qualified skill/kind. Calls
with identical content and distinct identities remain distinct. Hook metrics
deduplicate by project/session/event/hook. With native call IDs, pre/post phases
use distinct derived event identities. Otherwise a local delivery ID measures
the actual hook invocation without inventing a native tool-call identity. These
counts measure hook deliveries; duplicates cannot be correlated without native
IDs. No command-content hashes stand in for call identity. Missing session
identity makes collection unavailable. Contradictory
success/failure facts for one invocation are excluded from health calculations.

The runtime accepts only identifier-shaped skill/hook names and categorical
facts. Session/call/event/workspace identities are hashed. Commands, arguments,
outputs, reasoning, prompt text and arbitrary extra fields are discarded.
Names are host identifiers; the native adapter must never supply text extracted
from a document as a skill identity. Nothing is uploaded. Detailed governance
capture is not enabled by this metadata setting.

`skillHealthRecords(rows)` reuses the canonical tracker's record normalizer.
Only explicit completed/failed facts enter its denominator. Discovery,
selection, invocation and unknown outcomes are excluded. No second non-atomic
health sink is written. This adapter can be passed to the canonical health
collector as `stateStore.listSkillExecutionRecords`; the existing health CLI
continues to use its default store unless explicitly configured.

From a project directory, read collected metadata with:

```sh
node /absolute/path/ECC/scripts/copilot-telemetry.js
node /absolute/path/ECC/scripts/copilot-telemetry.js --health
```

The first command emits separate skill counters and measured hook count,
status frequencies and nearest-rank p50/p95 latency. The second emits canonical
known-outcome skill records. Missing token counts and USD costs remain `null`;
cumulative session totals are not summed. Context usage is `unavailable` until
a native usage source is verified. Existing cost-report remains independent.

## Dispatcher integration

After hook subprocesses return, the policy dispatcher measures elapsed wall
time and calls `recordHookMetric` using their actual aggregate process status,
trusted registry ID, canonical workspace and available native event/session IDs. Process success
is only hook success. Timed-out subprocesses are classified as `timeout`. Sink errors produce a
bounded content-free diagnostic and preserve the original hook decision and
tool outcome. Collection does not invoke hooks recursively. The metadata
module, CLI and lazy canonical tracker dependencies must be included in the
installed runtime closure before advertising the commands there.

## Validation and limits

`node tests/lib/copilot-telemetry.test.js` exercises disabled collection, all
skill facts, unknown outcomes, duplicate/distinct calls, concurrent-session
identity, invalid sources, unknown economic data, conflicts, lock contention,
workspace isolation, partial files and symlinks. The fixture adapter does not
certify native event delivery, governance capture, economic measurement or
context monitoring. These remain explicit native acceptance gaps in P04.
