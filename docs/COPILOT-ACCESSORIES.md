# Copilot accessory automations

P11 provides optional desktop completion and compact suggestions.
Set `ECC_COPILOT_NOTIFICATIONS=1` in the trusted Copilot launch environment to
opt in, and leave it unset to disable. The existing canonical hook controls
also apply: `ECC_HOOKS_ENABLED`, `ECC_HOOK_PROFILE` and
`ECC_DISABLED_HOOKS=stop:desktop-notify`. The minimal profile does not notify.
No installer starts a GUI or installs notification dependencies automatically.

The installed `agentStop` lifecycle hook invokes the provider once. The standalone
entry `scripts/hooks/copilot-accessories.js agentStop` ignores stdin and can only
send the generic completion notice. Both use the fixed title `ECC Copilot` and
never send a transcript, project name, path, tool output, prompt or summary to the
desktop. `Response completed` does not imply that the task or checks succeeded.

Set `ECC_COPILOT_COMPACT_SUGGESTIONS=1` alongside notifications to opt in to a
fixed suggestion at the end of a turn. The adapter checks the bounded native
journal for the exact workspace and session, and counts distinct main-agent tool
completions. It suggests `/compact` when the latest observed turn crosses 50
calls, then every additional 25 calls. Successful compaction resets the count;
ongoing compaction, forced continuation and missing or invalid journal evidence
suppress the suggestion and preserve the generic notice. Tool calls are a proxy
for conversation length. No hook estimates token pressure, submits `/compact`,
stores notification state or acts on tool output. Replayed host stops can repeat
the notice. Disable just this suggestion by unsetting its opt-in variable or by
adding `pre:edit-write:suggest-compact` to `ECC_DISABLED_HOOKS`.

| Platform | Provider | Prerequisites |
| --- | --- | --- |
| Windows native | System PowerShell, fixed BurntToast command | Existing BurntToast installation and interactive notification support |
| macOS | `/usr/bin/osascript`, fixed notification command | Notification permissions and a desktop session |
| Linux | `/usr/bin/notify-send`, fixed arguments | Existing notify-send and DISPLAY/Wayland desktop session |

Providers use argv with `shell: false`, a reduced environment, ignored stdout/
stderr and a 750 ms direct-child timeout. Missing tools, absent GUI, errors and
timeouts are advisory and leave the hook exit status successful. No provider
retry or fallback process chain runs. Windows native, Linux, macOS and WSL
notification delivery remain **native-unverified**; tests inject a fake runner
rather than triggering a desktop notification. WSL has no implicit PowerShell
fallback. Provider startup may exceed the budget and be skipped; this does not
justify extending the budget silently.

The canonical `desktop-notify.js` combines Claude transcript summaries, platform
probing and terminal ancestry discovery behind a single `run` entry. Reusing that
entry would retain Claude content and potentially long probes. This adapter
reuses canonical hook controls; extracting a shared bounded notification provider
from the canonical runtime remains a separate refactor. Generic notifications
are an explicit difference from canonical summary notifications.

| Canonical accessory | Copilot adaptation or limit |
| --- | --- |
| `session-start:plan-canvas-sessions`, `stop:plan-canvas-pending` | [Plan Canvas](COPILOT-CANVAS.md) uses explicit session binding, an opt-in notice of queued feedback and manual retrieval. Native browser and hook delivery remain separate gates. |
| `stop:desktop-notify` | Optional completion notice with fixed text and a bounded platform provider. Native desktop delivery is unverified. |
| `pre:edit-write:suggest-compact` | Optional end-of-turn suggestion based on persisted tool completions. Native SDK context utilization is ephemeral, so the file hook cannot establish token pressure. |
| `pre:compact` | [Lifecycle checkpoint](COPILOT-LIFECYCLE.md) supports optional bounded observations before compaction. No model invocation or confirmation of completed compaction is inferred from `preCompact`. |
| `post:bash:build-complete` | Disabled. Native hook success establishes tool-result success; a structured shell exit code paired to a foreground build is required before a build-success notice. Shell-completion notices expose a kind and display text, not that proof. |
| `post:bash:pr-created` | Disabled. A URL in output can be quoted, fabricated or belong to an existing PR. Enable only after a structured creation receipt is correlated to the originating tool call. No GitHub query or creation runs from this adapter. |
| `post:bash:command-log-audit`, `post:bash:command-log-cost` | No raw shell log is collected. [Telemetry](COPILOT-TELEMETRY.md) records bounded hook metadata; per-command native cost attribution remains unavailable. |
| tmux automation | No automatic tmux launch or Windows emulation. Existing dev-server guidance remains advisory. |

Contract references: [Copilot hook events](https://docs.github.com/en/copilot/reference/hooks-reference),
[streaming session events and persistence](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events),
and [manual compaction](https://docs.github.com/en/copilot/concepts/prompting-and-context/context-management).
Fixtures exercise the documented event shapes. Authenticated host delivery,
journal timing around `agentStop`, and platform desktop behavior require native validation.

Verification: `node tests/hooks/copilot-accessories.test.js`. Rollback: unset the
opt-in environment variable or disable `stop:desktop-notify`; no stored user data
is created or deleted.
