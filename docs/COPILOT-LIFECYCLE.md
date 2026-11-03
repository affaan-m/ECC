# Copilot CLI memory and lifecycle

The managed Copilot target has an independent session cache and four lifecycle
hooks. It does not run Claude's transcript consumers or read another harness's
home directory. Durable cross-harness memory continues to use the existing
ECC Memory Vault with the `copilot` source identity and a separately installed
`ecc-universal` runtime.

## Install and use

Run the installer from the destination project's root:

```bash
node /path/to/ECC/scripts/install-apply.js --target copilot --modules hooks-runtime,commands-core --enable-hooks
```

Use `--no-hooks` to keep manual session commands without automatic lifecycle
events. The runtime scripts install under `.github/ecc/scripts/`; automatic
registration is in `.github/hooks/ecc.json`. Existing managed ownership,
consent, repair, and uninstall rules apply.

| Event | Behavior |
| --- | --- |
| `sessionStart` | Register the native session; return a bounded historical checkpoint in `additionalContext`. A resumed session recalls only its own ID; a new session can recall the latest checkpoint in the exact workspace. |
| `agentStop` | Update metadata; optionally summarize the current native event file. Return `{}` without blocking or continuing the turn. |
| `preCompact` | Save the same optional bounded observations before compaction. Output is ignored by the host. |
| `sessionEnd` | Mark the session ended; keep its checkpoint. No transcript path is assumed. |

Automatic hooks honor `ECC_HOOKS_ENABLED`, `ECC_HOOK_PROFILE` and
`ECC_DISABLED_HOOKS`. Lifecycle IDs are `copilot:sessionStart`,
`copilot:agentStop`, `copilot:preCompact`, and `copilot:sessionEnd`; profiles
`standard` and `strict` enable them. Inherited Claude plugin options are
ignored. Set `ECC_SESSION_START_CONTEXT=false` or
`ECC_SESSION_START_MAX_CHARS=0` to disable automatic recall. The maximum context
budget is 20,000 characters; a smaller configured budget is respected, including
the historical warning and truncation marker.

Manual workflows `/save-session`, `/resume-session`, and `/ecc-sessions` invoke:

```text
node .github/ecc/scripts/hooks/copilot-lifecycle.js checkpoint --session <native-session-id> --stdin
node .github/ecc/scripts/hooks/copilot-lifecycle.js recall
node .github/ecc/scripts/hooks/copilot-lifecycle.js recall --session <native-session-id>
node .github/ecc/scripts/hooks/copilot-lifecycle.js list
```

Send a concise plain-text checkpoint through stdin. Do not interpolate its body
into a shell command. Use the real native session ID; missing IDs are errors,
not an invitation to invent one. Manual commands work with automatic hooks
disabled. They retain normal Copilot tool permissions.

## Storage and trust

State is stored in
`$COPILOT_HOME/ecc/projects/<sha256-real-workspace>/<sha256-session-id>.json`.
The default config root is `~/.copilot`. `COPILOT_HOME` must be absolute. If
Copilot is launched with a different `--config-dir`, set `COPILOT_HOME` to the
same directory for the hook subprocess. Workspace identity is the canonical
working directory: start Copilot and run manual commands from the same project
root. Separate worktrees and subdirectories remain separate scopes.

Records contain the native session ID, canonical workspace, lifecycle status,
last event, save time, and optional summary. No raw transcripts, shell commands,
tool results, assistant reasoning, credentials, global memory, or learned
instincts are copied. A manual checkpoint takes precedence over subsequent
automatic observations. Empty or failed transcript reads preserve the existing
checkpoint. Unknown event types are ignored; malformed known storage is an
explicit failure rather than an empty successful recall.

New directories use mode `0700`, files `0600` on POSIX. Writes use a private
exclusive temporary file, fsync and atomic rename. An exclusive per-session
lock prevents concurrent updates from overwriting one another; lock contention
returns an error rather than stealing a lock. After an interrupted writer,
inspect the session's `.lock` directory and remove it manually only after
confirming no writer is running. Static symlink directories, symlink files and
hardlinked files are rejected. These checks assume a trusted per-user config
root; they are not a sandbox against a hostile process concurrently replacing
directories under the same account. Windows ACL enforcement belongs to the host.

Summaries are untrusted historical evidence, never executable instructions,
permission grants, or completion proof. Suspected known token/private-key shapes,
credential assignments and unsafe control characters are rejected before
truncation. This is a backstop, not a complete sensitive-data classifier; review
manual summaries before saving them.

Limits are 1 MiB hook input, 16 KiB summary, 32 KiB state record, 4 MiB transcript,
128 KiB event line and 1,000 sessions per workspace. Oversized sources fail
explicitly without replacing the checkpoint. Storage is not pruned
automatically. Archive old records manually at the limit. Uninstall removes
managed project files and preserves private session data.

## Optional transcript observations

Reading the native transcript requires explicit opt-in before starting Copilot:

```bash
export ECC_COPILOT_TRANSCRIPT_SUMMARY=1
```

In PowerShell use `$env:ECC_COPILOT_TRANSCRIPT_SUMMARY = '1'`.
Only `agentStop` and `preCompact` inspect their supplied `transcriptPath`, and
only when it is the exact file
`$COPILOT_HOME/session-state/<current-session-id>/events.jsonl` with no symlink
descendants. Other session files and arbitrary supplied paths are rejected.

The supported event subset is native `user.message.data.content` and
`tool.execution_start` with audited tool names. It keeps at most ten short user
requests and thirty workspace-relative edit targets. Tool activity is labelled
unverified; it does not prove success. Subagent/ephemeral events, assistant
messages, reasoning, system messages, attachments, commands and tool results
are omitted. There is no LLM call or network request. Events are inspected to
derive observations; the raw event file is never imported into the cache or
Memory Vault. A CLI transcript schema change requires revalidation.

## Durable handoffs

After installing the separate `ecc-universal` runtime, use the canonical
`unified-memory` skill for durable context:

```text
ecc memory search "migration status" --target-harness copilot
ecc memory save --title "Migration status" --kind handoff --source-harness copilot --target all --stdin
ecc memory doctor
```

Follow the vault's project/team/user scope and unreviewed-data rules. The
Copilot installer does not automatically enable MCP, broaden user scope,
promote cache summaries, or fork the vault implementation.

## Validation and limits of evidence

```bash
node tests/hooks/copilot-lifecycle.test.js
node tests/lib/copilot-hooks-install.test.js
node tests/lib/copilot-commands.test.js
```

Subprocess and installer tests cover checkpoint → lifecycle → restore,
workspace/session separation, malformed/oversized sources, secret filtering,
static symlink/hardlink rejection, context budgets, manual checkpoint priority,
consent, reinstall, repair and uninstall. The native Copilot executable is not
available in the development environment. Real slash discovery, event delivery,
resume/clear/compaction and Windows/macOS behavior still require host validation.
Automatic background observation, automatic instinct promotion, other hook policies, MCP
configuration and native plugin packaging remain separate porting work.

Official contracts used for the adapter:

- [GitHub hook reference](https://docs.github.com/en/copilot/reference/hooks-reference)
- [CLI configuration directory](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
- [Copilot SDK streaming event shapes](https://github.com/github/copilot-sdk/blob/main/docs/features/streaming-events.md)
- [Copilot CLI skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills)
