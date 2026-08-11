---
name: context-budget
description: Routes live context checks to the native Codex or Claude Code meter without scanning files, and performs a bounded static component audit only when explicitly requested.
metadata:
  origin: ECC
---

# Context Budget

Use the provider's native meter for live session usage. Keep the separate,
estimated installation audit behind an explicit opt-in.

## Default: Live Context

Treat an invocation with no audit request as a live-context request. This
includes requests for the current window, remaining capacity, headroom, token
usage, or a context breakdown.

For this default path:

- Do not call or use tools.
- Do not scan or read files.
- Do not run shell commands, provider CLIs, debug logging, or MCP discovery.
- Reply with only the native command and one short explanation.

Route by the active harness:

| Harness | Native command | Guidance |
| --- | --- | --- |
| Codex CLI | `/status` | Shows current token usage and remaining context capacity. Use `/statusline` and enable **Context stats** plus **Token counters** for a persistent footer meter. |
| Claude Code | `/context` | Shows the live context breakdown. Use `/context all` for expanded items. |
| Other or unknown | None verified | State that ECC cannot read live provider state and ask which harness is active. |

A skill cannot invoke a TUI slash command on the user's behalf. Never replace
the native command with an estimated scan and never infer an audit request from
phrases such as “context is heavy” or “how much is left.”

## Explicit Static Audit

Run an installation/configuration audit only when the user explicitly says
`--audit`, “audit installed components,” or equivalent unambiguous wording.
`--verbose` changes report detail; it does not opt into an audit by itself.

If the audit scope is ambiguous, ask for the harness and installation root
before reading anything. Keep every audit bounded and read-only:

1. Inspect only the named plugin/install root and the named harness's known
   configuration files.
2. Never recursively enumerate the workspace root, home directory, provider
   cache, transcripts, debug logs, or unrelated worktrees.
3. Never launch a provider CLI, MCP server, or debug session to count tools.
4. Cap inventory output at 50 entries per component class. Summarize the rest.
5. Do not write temporary logs or copy configuration content into the report.

Audit only the component metadata relevant to eager discovery:

- agent and skill descriptions;
- command descriptions when the harness discovers them eagerly;
- always-loaded instruction files in the explicitly named scope;
- configured MCP tool schemas when an existing bounded manifest exposes them.

Full skill, agent, command, and rule bodies are generally on-demand content.
Report their disk size separately from estimated eager overhead instead of
adding every body to the session baseline.

## Audit Output

Return a compact report containing:

- harness and exact paths inspected;
- estimated eager/discovery overhead by component class;
- installed counts and the heaviest metadata entries;
- assumptions, unavailable measurements, and up to three optimizations.

Every calculated token number is an estimate of static configuration overhead,
not live session context. Do not claim that an estimate is provider-reported,
current, exact, or evidence of realized savings. Direct the user back to the
native live-context command for current usage.
