# Copilot event contract v1

`scripts/lib/copilot-event-envelope.js` is the shared interpretation boundary. It
has only Node built-in dependencies and executes no tools. The hook event passed
by the registered launcher is authoritative; a payload cannot select a policy,
script, runtime directory or different event.

This is an internal contract tested with synthetic fixtures. It is **not** a
claim that every Copilot CLI version emits these fields. Native Windows event
fixtures and the pinned CLI version remain required before certification.

## Envelope

`parseEventEnvelope(event, payload)` returns:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Internal schema version, currently `1` |
| `event` | Registered event; pre-tool, post-tool, stop and compact remain distinct |
| `sessionId` | Explicit session identity, or `null` |
| `callId` | Explicit tool call identity, or `null` |
| `turnId` | Explicit turn identity, or `null` |
| `workspace.requested` | Validated absolute payload cwd, defaulting to current cwd |
| `workspace.canonical` | Existing workspace resolved using `realpathSync` |
| `tool` | Tool native name, mapped name and normalized arguments; `null` for lifecycle events |
| `outcome.status` | `not-run`, `succeeded`, `failed`, `unknown`, or `not-applicable` |
| `outcome.source` | Explicit result field interpreted, or `null` |

The envelope intentionally excludes unknown payload fields and raw output. The
legacy `normalizeInput` function preserves the established canonical hook shape
and additional input fields, without changing the caller's object. Consumers
must treat all arguments as untrusted data even after normalization.

Supported native-to-canonical tool mappings preserve the existing adapter:
`bash` → `Bash`, `powershell` → `PowerShell`, `create`/`create_file` → `Write`,
`edit`/`str_replace_editor`/`apply_patch` → `Edit`, `view` → `Read`,
`grep`/`rg` → `Grep`, and `glob` → `Glob`. Unknown tool names remain unknown;
they never become a shell tool. Unknown events are rejected.

Camel-case and snake-case identity, tool and argument aliases must agree when
both are present. JSON string arguments are compared after decoding. Paths and
apply-patch targets use the existing strict validation, including move targets,
conflicting aliases and the 64-target limit. Input is limited to 1 MiB of UTF-8.
Future explicit internal schema versions are rejected.

## Outcomes and identity

Pre-tool is always `not-run`. Lifecycle events are `not-applicable`. A post-tool
callback alone never proves success. The synthetic result contract accepts an
explicit `toolResult.success` boolean or integer `toolResult.exitCode`; disagreeing
signals produce `unknown`. Missing fields, arbitrary output text and unsupported
result shapes stay unknown. No stdout parsing or absence-of-error inference is
used. `tool_result` is an equivalent alias and must agree if supplied together.

Native session transcript records read by `copilot-native-events.js` are a
different protocol; reading a `tool.execution_complete` event is not permission
to treat this hook-result fixture shape as native evidence.

Equal argument contents do not identify equal calls. Consumers may deduplicate
only within their own documented workspace/session/event scope using an
observed call ID. Absent call IDs must not be generated from content hashes.
No deduplication or persistent state is performed by this parser.

## Output and errors

`translateHookOutput` accepts canonical hook subprocess results. Any failed,
timed-out or unknown pre-tool process status, malformed output JSON or malformed
nested output object produces a denial. A nonzero exit wins over a purported
allow. Post-tool malformed output cannot grant permissions. Valid post-tool
diagnostics become bounded additional context.

`aggregateHookOutputs` gives deny priority over ask and allow for pre-tool events;
all other events strip permission fields. Additional context is bounded to
10,000 characters. Runtime launchers retain their existing subprocess deadline,
output-byte limit and fixed allowlist. This module does not grant capabilities
or bypass Copilot approval.

## State compatibility

This increment introduces no store migration and does not rewrite checkpoint,
instinct or transcript records. Existing store readers remain authoritative.
Any later versioned store migration must reject unknown future versions, preserve
the existing project-identity mapping and cursor semantics, back up the original,
and publish an atomic conversion plus rollback/read-compatibility fixtures.

## Verification

Operational limits inherited from the baseline are fixed for this contract:
1 MiB input, 64 edit targets, 5 seconds per canonical policy, 8 seconds across
targets for one adapter call, and a 15-second outer launcher timeout. Pre-tool
timeout is a denial. Required denial fixtures allow zero false negatives;
required benign fixtures allow zero unexplained false positives. These are
correctness and resource gates, not measured native latency claims. Native
latency p50/p95 budgets remain unset until P00 produces platform measurements;
M1 cannot pass with those measurements absent. A threshold change requires a
new recorded baseline rather than adjusting a gate after seeing a result.

The internal adapter timeout above differs from the native outer hook timeout.
Copilot's documented outer timeout is fail-open, including pre-tool hooks; the
adapter cannot emit a denial after its host has killed it. Native permission
controls remain necessary. Inner deadlines are deliberately shorter than the
outer timeout and are covered by subprocess tests.

Run `node tests/lib/copilot-event-envelope.test.js`. It covers malformed/future
input, conflicts, missing outcome evidence, distinct identities, denial priority,
and execution from a copied directory with no source checkout. The suite is
automatically discovered by `node tests/run-all.js copilot`. Adapter and installer
regression suites remain necessary after integration.
