# Copilot observation and learning identity mapping

Checkpoint/observation storage uses a SHA256 of the canonical workspace path.
The canonical continuous-learning backend uses its own 12-character project ID,
derived from normalized Git origin/worktree identity or the explicitly selected
non-Git directory. These namespaces remain distinct. Mapping them does not rename
checkpoint or observation files, rewrite IDs, import transcripts or activate an
instinct.

Run from the relevant workspace using the installed Python executable:

```text
python .github/ecc/scripts/copilot-learning.py identity
python .github/ecc/scripts/copilot-learning.py identity --apply
```

`identity`/`identity --dry-run` previews the binding without creating the configured
Copilot home. It invokes the existing canonical `detect_project()` in a temporary
backend home so canonical Git normalization has one implementation. `--apply`
invokes that same canonical backend against the existing Copilot learning store,
using its existing project registry and legacy migration behavior, then publishes
one explicit immutable binding:

```json
{
  "schema": "ecc.copilot.learning-mapping.v1",
  "observationProjectId": "<64-character workspace SHA256>",
  "learningProjectId": "<12-character canonical backend ID>",
  "identitySource": "canonical-detect-project"
}
```

The file is `$COPILOT_HOME/ecc/learning-mappings/<observationProjectId>.json`,
separate from checkpoint JSON scans and from active instincts. The CLI response
has `ok`, `operation`, `mapping` and `applied`; callers must inspect both process
exit status and `ok`. No remote URL, credentials or workspace path enter the
mapping record. Distinct workspaces can point to the same canonical learning
project, including worktrees and clones sharing an origin.

An existing binding is create-only and idempotent. Changing the workspace's
learning identity, malformed/future schemas, unknown fields, linked files,
redirected mapping directories or a contended learning lock cause rejection.
No mapping is reassigned automatically. Publication uses a private fsynced file
and exclusive link while holding the existing learning writer lock. A filesystem
without the required exclusive-link support reports failure rather than falling
back to overwrite. An interruption during publication may require inspecting the
mapping directory and lock before retry; an outcome is not inferred from timeout.

Preview predicts the canonical identity. If the persistent backend resolves a
different legacy fallback during explicit apply, the mapping is rejected and the
operator must inspect canonical migration; it is never silently rebound. Existing
canonical project records are handled by the canonical backend, not by copying or
rehashing them in this adapter.

`node tests/lib/copilot-learning-mapping.test.js` exercises actual Python/Git
subprocesses for non-Git workspaces, origin normalization, worktrees, preserved
legacy records, malformed schemas, hardlinks, redirected directories and locks.
The existing learning regression suite remains applicable. Native Windows path
identity and exclusive publication, macOS and complete crash/fault-injection
matrices remain unverified. This command does not start a worker or enable capture.
