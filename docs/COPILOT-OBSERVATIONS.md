# Copilot metadata observations

P05 capture is opt-in: set `ECC_COPILOT_OBSERVE=1` in the launch environment.
The project hook installer adds one fixed sink per pre/post-tool event, subject
to the existing standard/strict profile and `copilot:observe` disable control.
Disabled capture creates no store. Transcript-summary configuration is separate.

Records use canonical learning field names (`timestamp`, `event`, `tool`,
`session`, `project_id`, `tool_use_id`) plus a version and explicit outcome.
They contain no prompts, commands, paths, arguments, outputs or reasoning.
Unknown tool names become `unknown`; identifiers are hashed. These are metadata
observations, not evidence of a particular user's correction or a learned rule.

The location is `$COPILOT_HOME/ecc/projects/<workspace SHA256>/observations.jsonl`
(default Copilot home: `~/.copilot`). The workspace hash deliberately matches the
existing checkpoint namespace. **It does not replace the canonical learning
backend's 12-character remote/worktree project identity.** The explicit
`copilot-learning.py identity --apply` binding now connects the namespaces using
the canonical identity resolver. The separately selected metadata observer
consumes the bound observations; see [mapping](COPILOT-LEARNING-MAPPING.md) and
[observer](COPILOT-OBSERVER.md). Native acceptance remains a separate gate.
The sink never writes active instincts, Vault records or the canonical registry.

The sink retains up to 2,000 observations / 1 MiB for 30 days, pruning oldest
records only during an enabled write. An exclusive writer lock, owner-only
temporary file, fsync and atomic replacement protect cooperative updates. Future
schemas, foreign project hashes, unknown extra fields, interrupted records,
symlinks and hardlinks are rejected. Contention or disk errors produce an
unavailable diagnostic and never manufacture a tool result or repeat a tool.

When a native call ID exists, duplicate delivery of the same event/session/call
does not add a row. Contradictory duplicate outcomes remain `unknown`. Pre and
post events remain separate; separate calls with identical content are retained.
Without call IDs, events cannot be reliably deduplicated. Retention also bounds
the deduplication horizon. A post event with no usable native outcome remains
unknown; a delivered hook does not establish tool success.

`node tests/lib/copilot-observations.test.js` and the installed-runtime test
exercise the data boundary. Native event delivery, full disk/crash fault injection
and Windows process/filesystem behavior remain unverified. No observer, model
call, daemon or scheduled task starts during capture or installation. Disable
capture to roll back while preserving existing records. Stale locks require
operator inspection; they are never stolen automatically.
