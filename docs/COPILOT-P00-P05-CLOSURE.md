# P00–P05 implementation verification

Date: 2026-11-04, Europe/Rome. This records completed implementation work and
fixture verification. The original phases retain native acceptance gates;
none is relabelled fully verified without the required host evidence.

| Phase | Implementation and automated evidence | Native gate still pending |
| --- | --- | --- |
| P00 | Complete source inventory; baseline 167/167; real CLI 1.0.105 Linux discovery of 389 project skills, all enabled, plus 2 built-ins | Windows discovery, native event payloads and checkpoint/restart |
| P01 | Versioned parser, native resultType/failure handling, alias conflicts, fail-closed inner execution, deny priority and installed dependency closure | Authenticated hook delivery and platform latency acceptance |
| P02 | Bash/PowerShell corpus; sensitive and destructive denials; preflight; optional full-content Read-before-edit proof, session/turn/lifecycle/expiry checks | Windows corpus and real native full-view format; partial/truncated/unknown view output gives no proof |
| P03 | Check/fix quality, dedup/revisions, bounded canonical design input, crash-lock recovery, warning exit code 2 without extra turns | Native check/fix feedback and real project toolchains on declared OS |
| P04 | Actual measured hook deliveries; explicit persisted skill.invoked import; qualified source/name/path identities; unavailable terminal/context/governance signals remain unavailable | Authenticated event emission and ephemeral-signal availability |
| P05 | Opt-in minimized capture, canonical identity mapping and backend consumption; disk/rename faults, quotas/retention, isolation and out-of-order events | Native Windows filesystem/event fault matrix |

The reproducible fixture gate is:

```text
npm run copilot:inventory
npm run copilot:verify-core
```

The checked-in [verification report](../manifests/copilot-core-verification.json)
records all 15 script checks passing, their exit codes, durations and output
digests, the platform/runtime and the source-inventory digest. Raw subprocess
output and private bodies are not published. `fixturesPassed: true` is distinct
from `complete: false`. `--require-native` makes the fixture-only verifier exit 2
while those external acceptance gates remain pending; it cannot manufacture a
native certification from a successful fixture run.

The expanded Copilot regression run found 356 passing tests and one failing
P07 remote-MCP test in an unfinished implementation outside this closure. This
is not reported as a green full suite. The P00–P05 gate passes independently.
Repository validators and checks for manifests, profiles, carrier closure,
personal paths, catalog and command registry were also executed separately.

## Optional controls

- `ECC_COPILOT_FACTFORCE=1`: require valid complete-read evidence for existing
  ordinary code edits. It grants no permission for sensitive targets or shell
  operations. Partial/unknown output is rejected; disable the option to roll
  back this gate independently. No invented native turn identity is used.
- `ECC_COPILOT_QUALITY_MODE=check|fix|off`: check is the default; fix is explicit.
  Missing tooling is unavailable. Warnings do not force another agent turn.
- `ECC_COPILOT_TELEMETRY=1`: collect measured hook deliveries and supported native
  skill facts only. Invocation is not completion. Missing costs stay null.
- `ECC_COPILOT_OBSERVE=1`: capture metadata only, separately from checkpoint
  transcript summaries. Explicit learning identity binding is still required.

Pre/post Read correlation, file hashes and complete native output attest observed
content, not comprehension or user authorization. All new policies use existing
hook profiles/disable controls. Failed capture cannot create a read proof or
replace a denial. An outer host timeout can skip a hook; internal deadlines are
shorter, but these workflow guards do not replace native tool permissions.

The remaining evidence must be gathered on the actual hosts using
[the native acceptance runbook](COPILOT-NATIVE-ACCEPTANCE.md). Full phase closure
and M1 remain pending until those named gates pass or the user explicitly accepts
a scope change. No scope reduction is assumed here.
