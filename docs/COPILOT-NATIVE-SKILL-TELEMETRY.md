# Native skill telemetry adapter

The P04 importer consumes explicit persisted `skill.invoked` events from the
Copilot session journal. Collection remains opt-in with
`ECC_COPILOT_TELEMETRY=1`. The fixed hook entrypoint is
`scripts/hooks/copilot-native-telemetry.js agentStop|sessionEnd`; it must be
registered and distributed alongside `scripts/lib/copilot-native-skill-telemetry.js`.
It never scans installed skills or interprets citations/file reads as usage.

## Contract and provenance

Primary schema inspected 2026-11-04:
[GitHub Copilot SDK generated session events](https://github.com/github/copilot-sdk/blob/main/nodejs/src/generated/session-events.ts),
interfaces `SkillInvokedEvent`, `SkillInvokedData`, and `SkillsLoadedEvent`.

A supported invocation has a UUID v4 event ID, ISO timestamp, a known source,
name, absolute SKILL.md path and trigger. The native event ID identifies this
observed skill activation; it is not a fabricated shell/tool-call ID. The
importer uses the existing bounded `readSessionEvents` reader, which attests
session identity and canonical workspace and refuses foreign or mixed-workspace
journals, symlinks, hardlinks and oversized records. No event chooses a journal
path or executable. The only journal is the selected session's managed native
`events.jsonl` file.

| Native fact | Recorded counter | Limit |
| --- | --- | --- |
| user-invoked or agent-invoked `skill.invoked` | invoked | Not completion or success |
| context-load `skill.invoked` | selected | Preloading is not execution |
| `session.skills_loaded` | no persisted fact | SDK declares this event ephemeral |
| Citation, file read, generic tool completion | none | No explicit skill activation identity |
| Missing/unsupported source, path or trigger | unavailable/ignored | No guessed identity |
| Replayed checkpoint journal record | ignored | Not a new observation |

A qualified skill ID combines the known source, bounded name and a hash of its
source path. Two skills with the same name in different origins remain separate.
Project paths must resolve inside the attested workspace; their canonical path
is hashed. Source paths themselves are never persisted in telemetry. Pathless
SDK, builtin or remote skills remain unmeasured by this filesystem-identity
adapter. It does not invent an origin when a native event omits it.

The importer excludes event content, arguments, model IDs, allowedTools, plugin
metadata and all unknown fields. These fields cannot grant approvals or select
code. Native event/session IDs are hashed by the existing telemetry sink. The
sink's bounds, retention, lock discipline and atomic writes continue to apply.
Re-importing the same supported activation deduplicates by its native identity;
other activations remain distinct even with identical names and content.

## Outcomes and unavailable data

Invocation events carry no mapped terminal skill outcome. The importer never
creates completed/failed health records. Existing `skillHealthRecords` continues
to exclude nonterminal facts from its success/failure denominator. The report
labels skill outcomes, context usage and detailed governance as unavailable;
missing journal/signals are unavailable rather than zero skill usage. Costs and
tokens remain the existing separate cost-report concern.

Optional hook failures produce only a generic diagnostic and `{}`. They do not
change the tool outcome, grant permissions, trigger retries, or block stop.
Disable collection to roll back, preserving earlier telemetry.

## Verification

```text
node tests/lib/copilot-native-skill-telemetry.test.js
node tests/hooks/copilot-native-telemetry.test.js
```

Fixture tests cover native schema interpretation, opt-out, absent signals,
replay, source qualification, preload distinction, name collisions, foreign
sessions/workspaces and sentinel contents. This is source-contract and fixture
evidence. Actual emission/persistence in a model-authenticated Copilot session,
CLI-version differences and Windows delivery remain native acceptance gates;
the existence of a generated SDK type does not prove emission on every host.
