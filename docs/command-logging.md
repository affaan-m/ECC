# Command log retention

The optional audit and development command hooks write private command logs
using the standalone `scripts/hooks/post-bash-command-log.js` helper. Commands
pass through the existing secret redaction before being recorded.

Rotation keeps the active log and one archive. Writers coordinate the size
check, rotation, and append with a cross-process lock so simultaneous rotations
do not overwrite newly archived history. Only a lock whose owner is verifiably
dead can be reclaimed; elapsed time alone never establishes ownership.

Logging waits at most 500 milliseconds for ownership, then appends without
rotating. The size limit is best effort: rotation resumes when ownership becomes
available. Unsupported lock operations or an orphaned recovery guard can defer
rotation indefinitely while command recording continues. The recovery guard is
not recursively reclaimed, so operators should investigate persistent lock files
and establish that all writers have stopped before removing an orphan guard.
