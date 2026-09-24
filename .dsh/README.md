# DeepSeek Harness adapter

ECC on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) — the harness
behind `dsh web`, `dsh tui` and `dsh headless`.

State: **Adapter-backed.** Skills, rules and hooks all land; hooks need the bridge in
[`plugin/`](plugin), because DSH's shipped Claude Code bridge covers only part of the hook surface
ECC uses.

| ECC asset | How it lands in DSH |
|---|---|
| `skills/*/SKILL.md` | Symlinked into `$DSH_HOME/skills`, which DSH scans live (no restart) |
| `hooks/hooks.json` | [`plugin/`](plugin) runs it through `ctx.shell` on every DSH extension point |
| `rules/*`, instructions | Paste into `$DSH_HOME/AGENTS.md` or a project `AGENTS.md`; DSH does not expand `@path` imports |
| `agents/*.md`, `commands/*` | Not ported: DSH has native subagents and no Claude Code slash commands |
| MCP config | Mountable as a DSH MCP bundle; not wired by this adapter |

## Install

```bash
./.dsh/install.sh                       # hooks only
./.dsh/install.sh --skills              # also link the 292 skills into $DSH_HOME/skills
./.dsh/install.sh --dry-run             # print what would happen
```

Options: `--profile <name>` (default `web`), `--dsh-home <path>` (default `$DSH_HOME` or `~/.dsh`),
`--skills`, `--dry-run`. The script only writes inside `$DSH_HOME`: it copies `hooks/hooks.json`,
installs the bridge into `$DSH_HOME/local-bundles/dsh-cc-hooks/`, and registers that bundle with
`dsh plugin --profile <name> add`. Nothing else is touched, and re-running is safe.

Remove it with:

```bash
dsh plugin --profile web remove dsh-cc-hooks
rm -rf "$DSH_HOME/local-bundles/dsh-cc-hooks" "$DSH_HOME/claude-compat/ecc-hooks.json"
```

## Hook coverage

The bridge serves every event ECC's `hooks/hooks.json` uses — the four DSH's shipped bridge does,
plus three it has no hook point for:

| ECC event | DSH extension point |
|---|---|
| `SessionStart` | `agent/created` |
| `UserPromptSubmit` | `agent/pre-step` |
| `PreToolUse` | `tools/pre-execute` |
| `PostToolUse` | `tools/post-execute` |
| `PostToolUseFailure` | `tools/post-execute` with `result.isError` |
| `PreCompact` | `session/event` → `compaction/start` |
| `Stop` | `agent/turn-stopping` |
| `SubagentStart` / `SubagentStop` | `subagent/start` / `subagent/end` |
| `SessionEnd` | `session/disposed` |

Three translation rules make Claude Code hooks work unchanged:

1. **Tool names.** DSH tools are lowercase (`bash`, `edit`, `write`); matchers are Claude Code
   names (`Bash`, `Edit|Write|MultiEdit`). A group matches either name, and the payload carries
   the Claude Code alias.
2. **PreToolUse context.** DSH's `PreToolDecision` has no context field, so a PreToolUse hook's
   `additionalContext` is buffered per call and attached to that call's result at
   `tools/post-execute`.
3. **Transcripts.** `transcript_path` is always empty in the shipped bridge, which blinds cost and
   session-evaluation hooks. The bridge renders a Claude Code JSONL transcript from
   `sessionQuery.readSurface` into `$DSH_HOME/cc-hooks/transcripts/`, refreshed on a throttle.

Hook profiles are ECC's own switch, set in the generated bundle patch:
`ECC_HOOK_PROFILE=minimal | standard | strict` (default `minimal` keeps the blocking gates off),
plus `ECC_DISABLED_HOOKS=pre:edit-write:gateguard-fact-force,…` for individual hooks.

## Measured cost

Per invocation, on an 8-core ARM board (Radxa Cubie A7A, DSH 0.1.7-rc.1):

| Hook | Event | ms |
|---|---|---|
| SessionStart bootstrap | `agent/created` | ~320 (once per session) |
| `pre:edit-write:gateguard-fact-force` | PreToolUse | 82 |
| `pre:write:doc-file-warning` | PreToolUse | 95 |
| PostToolUse dispatcher (sync + async) | PostToolUse | 137 + 566 **per tool call** |
| Stop hooks (minimal profile) | `agent/turn-stopping` | 300–1500 per turn |

The PostToolUse pair is the expensive one; drop it with
`ECC_DISABLED_HOOKS=pre:observe,post:session-activity-tracker` or by removing that group from
`$DSH_HOME/claude-compat/ecc-hooks.json`.

## Verification

```bash
node .dsh/plugin/test.mjs        # matcher, codec, merge and payload translation
node scripts/harness-adapter-compliance.js --check
```

End-to-end check on a live harness: start a `dsh` session and confirm the bridge wrote its mount
line.

```bash
tail -3 "$DSH_HOME/cc-hooks/cc-hooks.log"
```

## Known differences from Claude Code

- **PreToolUse warnings arrive with the tool result**, not before dispatch (DSH limitation).
- **SessionStart context can miss the very first request** — the point runs detached.
- **Subagents also receive session-start context**, because DSH fires `agent/created` for
  in-process children too.
- **Slash commands and `.md` subagent definitions do not port**; use skills and DSH's native
  subagents instead.
- **ECC hooks still write their own state** under `~/.claude/` (`session-data/`,
  `skills/learned/`) and `~/.local/share/ecc-homunculus/`; that is ECC behaviour, not a DSH path.
- **The skill catalog is injected into every request.** Linking all 292 skills is a deliberate
  trade (see `--skills`); a curated subset is usually better.
