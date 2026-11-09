# Copilot metadata observer

The explicit `metadata-sequences` backend analyzes minimized successful tool
deliveries and proposes **pending-review** tool-order hypotheses. It does not
read commands, outputs, prompts or reasoning, infer user corrections, activate
instincts, or call a model. This is a narrow deterministic backend for P06;
semantic learning and native Windows worker certification remain unverified.

No observer starts during installation or from a hook. First bind the workspace
to the existing canonical learning project identity, then choose the backend:

```text
python .github/ecc/scripts/copilot-learning.py identity
python .github/ecc/scripts/copilot-learning.py identity --apply
node .github/ecc/scripts/copilot-observer.js once --backend metadata-sequences
node .github/ecc/scripts/copilot-observer.js candidates
```

Use the actual installed Python executable on Windows. Identity preview is
read-only; applying it preserves the canonical backend's 12-character remote /
worktree identity while observations keep their existing workspace SHA256. The
observer requires that explicit mapping and never guesses or rewrites it.

The built-in analysis module is an import-free pure function receiving only the
strict metadata schema. It has no provider callback, subprocess interface,
filesystem or network handle. Tool names and generated text come from fixed
templates. Unsupported backend names are rejected. This is a structural boundary
for trusted built-in code, not an OS sandbox for arbitrary downloaded code.
Semantic LLM backends are unsupported. Adding one requires its own isolation
and evaluation before use; an unrestricted agent subprocess is not a fallback.

Candidates require an adjacent successful Read/Grep/Glob → Edit/Write delivery
pattern in at least three distinct sessions. Failed or unknown outcomes do not
establish successful ordering; ambiguous equal timestamps are skipped. Native
call IDs deduplicate deliveries when available. Standard host hooks can omit
those IDs: no synthetic IDs are persisted, delivery-pair counts can include
duplicates, and distinct sessions are the evidence threshold. Ordering alone
does not demonstrate that the workflow is beneficial or that a user prefers it.
The fixed confidence value 0.5 is a heuristic, not a calibrated probability.

## One-shot state and review

The writer uses a separate `observer/candidates.json` beneath the existing
workspace-private project directory. The file contains a versioned cursor and
up to six candidate templates. Snapshot hashes, rather than a positional offset,
make replay idempotent. If the prior last record disappears during retention or
rotation, the result reports `rotationDetected: true`; analysis recomputes the
bounded current snapshot instead of reinterpreting an old offset. Candidate
proposals describe the current capture window and can disappear when supporting
observations leave that window. They are not the canonical active instinct store.

Candidate and cursor are written in one owner-only, fsynced, atomic replacement
under an exclusive writer lock. Malformed/future schemas, foreign mappings,
linked files/directories, extra raw fields and modified candidate templates fail
without rewriting the previous store. A crash before replacement leaves the
previous coherent snapshot; replay produces the same IDs. Locks are never stolen.
An abrupt writer process exit can leave `candidates.json.lock` and an unfinished
temporary file. A subsequent analysis fails explicitly until an operator verifies
that the writer is absent and inspects that lock. Worker `recover` does not clear
the separate writer lock. A crash after replacement can have committed a valid
snapshot even though the caller saw no success; after verified lock resolution,
replaying that same capture returns `unchanged` without multiplying evidence.

Export one proposal as canonical instinct Markdown for separate human review:

```text
node .github/ecc/scripts/copilot-observer.js export --candidate metadata-read-before-edit
```

Export writes only stdout. Review its trigger, scope, fixed action and evidence;
the existing canonical import/evolve commands remain the explicit downstream
workflow. This observer does not duplicate canonical keyword clustering,
evolution, promotion or pruning, and never imports a candidate automatically.
Exporting or reading a pending proposal does not grant permission to activate it.
The export fixtures run the actual canonical `parse_instinct_file` implementation
and verify its identity, scope/project binding and confidence fields.

Installed lifecycle tests exercise the distributed files in isolated projects,
without resolving runtime modules from the source repository. Commands plus
consented hooks capture native-shaped successful post-tool events across three
sessions. A separate skills-only installation uses the installed sink's normalized
input API: automatic host capture still requires the separately consented hooks.
Both flows apply the canonical identity, produce one pending candidate, parse its
export with the installed Python backend, replay without rewriting state, then
start and cooperatively stop a bounded worker while preserving captured data.

## Managed worker

```text
node .github/ecc/scripts/copilot-observer.js start --backend metadata-sequences --interval-ms 300000 --duration-ms 1800000 --max-runs 20
node .github/ecc/scripts/copilot-observer.js status
node .github/ecc/scripts/copilot-observer.js stop
```

Start explicitly launches one fixed Node entrypoint. An exclusive ownership
directory and child claim prevent a second worker; a random start token prevents
one worker from removing a replacement owner's state. The defaults are five
minutes between analyses, thirty minutes maximum lifetime and twenty runs. Hard
limits are 250–300000 ms interval, 1000–3600000 ms lifetime and 1–100 runs. A
monotonic deadline prevents a backwards wall-clock shift extending the lifetime.
No paid calls occur in this backend.

Stop writes a token-bound cooperative cancellation request. The worker checks it
at most every 250 ms between bounded analyses. It sends no termination signal to
any PID. Status reports registration and PID existence, which is not process
identity attestation; incomplete ownership reports unavailable. Last-run metadata
distinguishes completed, stopped, expired and failed runs without retaining error
bodies. A malformed observation file ends the worker with an explicit failed
result rather than an apparent successful analysis.

An abruptly killed worker can leave an ownership lock. Only after status reports
a confirmed absent registered PID can its exact token recover that lock:

```text
node .github/ecc/scripts/copilot-observer.js recover --token TOKEN_FROM_STATUS
```

Recovery never kills a process, removes observations or deletes candidates. A
reused/live PID, unknown liveness, missing startup PID, changed token or unsafe
lock requires operator inspection rather than automatic recovery. Startup crash
locks with no attested PID are intentionally not cleared by this command.

Linux subprocess tests cover one-shot/replay, rotation, raw-field injection,
candidate tampering, mapping mismatch, duplicate workers, cooperative stop,
bounded run count, failure status, dead-PID recovery and links. Actual child exits
immediately before and after candidate replacement verify coherent old/new
candidate-and-cursor snapshots, explicit crash locks and idempotent replay;
retention/rotation removes candidates whose three-session support has expired.
Native Windows / macOS survival, stop responsiveness, clock fault injection and provider/model
learning evaluations remain separate P06/P12 acceptance gates. See the
[worker decision](design/copilot-observer-worker.md) for the supervision choice.
