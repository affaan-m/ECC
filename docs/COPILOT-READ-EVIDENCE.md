# Copilot observed Read-before-edit evidence

Enable explicitly with `ECC_COPILOT_FACTFORCE=1`. The default is off so existing
profiles retain their meaning. This is a narrow fact-forcing equivalent for
existing ordinary code files, not the full Claude transcript questionnaire.
Sensitive paths and destructive commands remain denied by the separate guard;
read evidence never grants permission for them.

The recording hook uses actual pre/post tool events. A successful native `view`
or equivalent `Read` must match an earlier pre-read snapshot of the same file,
content digest and filesystem identity. The native result text must visibly
contain every unchanged source byte. Success alone, a claimed complete-read
flag, or unknown output decoration cannot establish completeness. Missing,
truncated, line-number-decorated or conflicting text aliases therefore remain
unsupported unless the actual full source is present verbatim. Source/output is
compared only in memory, never persisted. Failed/unknown outcomes, partial-range
reads, changed files, linked targets and paths outside the canonical workspace
cannot establish proof. Recording only after a read would be insufficient: a
file could change between the tool operation and its post hook.

Proofs contain only hashed target/session/workspace identities, content hashes,
file identity metadata, native event times and optional hashed native call/turn
identities. No source, tool output, prompts, credentials or transcripts are saved.
The private location is `$COPILOT_HOME/ecc/projects/<workspace-hash>/read-evidence/`
with one isolated state directory per native session. Checkpoint schemas and
their scanners remain unchanged.

## Lifecycle and expiry

`sessionStart` and `userPromptSubmitted` establish a known active boundary.
`agentStop` and `sessionEnd` clear proofs and close that boundary.
`preCompact` clears old proofs and establishes a fresh observed boundary while
allowing the continuing turn to obtain a new complete read. It does not invent a
new native turn ID or require another user prompt. A duplicate compact event at
the same boundary does not erase evidence collected afterwards. Event timestamps must be available; delayed events older than a boundary
cannot reopen it. Closing boundaries win ambiguous equal timestamps. Pre-read
must be strictly later than its lifecycle boundary, and post-read strictly later
than pre-read; equal-time ordering is unsupported rather than guessed.

When native turn IDs exist, the lifecycle, read and edit identities must agree.
When they do not exist, no synthetic native turn ID is invented: evidence is
bounded by observed lifecycle events and a fixed 10-minute maximum lifetime.
Clock regressions fail the age check. A subsequent file modification invalidates
proof by digest/identity comparison and requires another successful read.
Identical duplicate successful post-read delivery cannot manufacture another
proof; a failure delivery invalidates pending proof.

Before an Edit/Write of an existing target classified `code` by canonical
GateGuard, every target in the batch must have a current matching proof. New
files and other canonical target classes are outside this narrow equivalent;
the existing config, sensitive-target and destructive-operation policies still
apply. Directory/search observations do not pretend to prove source semantics.
Successful Read evidence proves an observed tool action against an unchanged
target, not that a model understood every line or answered architecture questions.

## Failure, bounds and rollback

Recording failures are advisory: the bookkeeping hook returns no permission.
Guarded edits still fail closed when required evidence is absent or invalid.
Disabling only `copilot:read-evidence` does not permit stale proofs to bypass the
guard. To roll back this optional feature, unset `ECC_COPILOT_FACTFORCE` while
preserving its store. Existing hook controls still govern guard installation.

Writes use an exclusive lock, owner-only temporary file, fsync and atomic rename.
The store has a 64 KiB bound and at most 64 pending reads/proofs per session
boundary. Reads are bounded to 1 MiB. Symlinks, hardlinks, future schemas, extra
state fields, foreign identities and lock contention are rejected. A crash may
leave a lock requiring manual inspection; no stale lock is silently stolen.

Fixture command: `node tests/lib/copilot-evidence.test.js`. Tests cover pre/post
correlation, file races, failed/partial reads, replay, expiry, lifecycle/turn
isolation, full/truncated output, equal-time ambiguity, compact continuation,
batches, links, malformed stores, disabled recording and bounded CLI
behavior. Native Windows delivery and native model-visible feedback remain
unverified. This implementation cannot close the plan's native P02 gate alone.
